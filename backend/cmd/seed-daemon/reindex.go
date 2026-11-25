package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	documentsv3 "seed/backend/api/documents/v3alpha"
	"seed/backend/blob"
	"seed/backend/config"
	"seed/backend/logging"
	"seed/backend/storage"
	"seed/backend/util/pprofx"

	"github.com/peterbourgon/ff/v4"
	"golang.org/x/term"
)

const reindexLongHelp = `Forces a full reindex of the database in the data directory, using the same code path as the daemon. The daemon must not be running on the same data directory.

If the data directory needs a schema migration, you are asked to confirm it first, or pass -allow-migrations to skip the question. The reindex runs in a single transaction, so interrupting it leaves the previous index intact.

The data directory and the log level come from the daemon flags, which can be given before or after the subcommand name. The data directory must be given explicitly (with -data-dir, SEED_DATA_DIR, or SEED_DAEMON_FLAGS): the default one is never reindexed by accident.`

// reindexOptions are the flags specific to the reindex subcommand.
type reindexOptions struct {
	AllowMigrations  bool
	ProgressInterval time.Duration
	ProfileDir       string
}

// newReindexCmd creates the reindex subcommand. It inherits the daemon flags from parent,
// and reads the data directory and the log level from cfg once the flags are parsed.
func newReindexCmd(cfg *config.Config, parent *ff.FlagSet) *ff.Command {
	dataDirFlag, ok := parent.GetFlag("data-dir")
	if !ok {
		panic("BUG: daemon flags must define -data-dir")
	}

	var opts reindexOptions

	// Defined with the standard flag package, so the flags take a single dash like the daemon ones.
	stdfs := flag.NewFlagSet("reindex", flag.ContinueOnError)
	stdfs.BoolVar(&opts.AllowMigrations, "allow-migrations", false, "Apply pending schema migrations without asking for confirmation")
	stdfs.DurationVar(&opts.ProgressInterval, "progress-interval", 15*time.Second, "How often to print progress")
	stdfs.StringVar(&opts.ProfileDir, "profile-dir", "", "If set, write CPU, trace, heap, block, mutex, and other runtime profiles of the reindex into this directory")

	return &ff.Command{
		Name:      "reindex",
		Usage:     "seed-daemon reindex [FLAGS]",
		ShortHelp: "Force a full reindex of the database in the data directory.",
		LongHelp:  reindexLongHelp,
		Flags:     ff.NewFlagSetFrom(stdfs.Name(), stdfs).SetParent(parent),
		Exec: func(_ context.Context, args []string) error {
			if len(args) > 0 {
				return fmt.Errorf("reindex: unexpected arguments %q", args)
			}

			// Reindexing is slow and rewrites the index, so the default data dir is not good enough.
			if !dataDirFlag.IsSet() {
				return errors.New("reindex: the data directory must be given explicitly with -data-dir, SEED_DATA_DIR, or SEED_DAEMON_FLAGS")
			}

			// No signal trapping on purpose: the reindex doesn't watch a context,
			// so the default behavior (exit on Ctrl+C) is what we want. SQLite rolls back the unfinished transaction.
			return runReindex(cfg.Base, opts)
		},
	}
}

// runReindex implements the reindex subcommand.
func runReindex(base config.Base, opts reindexOptions) error {
	if err := base.ExpandDataDir(); err != nil {
		return err
	}

	status, err := storage.CheckMigrations(base.DataDir)
	if err != nil {
		return err
	}

	if status.CurrentVersion == "" {
		return fmt.Errorf("data directory %q is not initialized: nothing to reindex", base.DataDir)
	}

	if len(status.Pending) > 0 {
		fmt.Fprintf(os.Stderr, "WARNING: data directory %q needs a schema migration from %s to %s (%d pending).\n",
			base.DataDir, status.CurrentVersion, status.DesiredVersion, len(status.Pending))
		fmt.Fprintln(os.Stderr, "Migrations can't be undone, and older versions of Seed won't be able to open the migrated data directory.")

		if !opts.AllowMigrations {
			ok, err := confirm(os.Stdin, os.Stderr, "Apply the migrations and continue?")
			if err != nil {
				return err
			}

			if !ok {
				return errors.New("aborted: schema migration not confirmed")
			}
		}
	}

	start := time.Now()

	// The key store is only needed by the API layer, not by indexing.
	store, err := storage.Open(base.DataDir, nil, nil, base.LogLevel)
	if err != nil {
		return err
	}
	defer store.Close()

	if len(status.Pending) > 0 {
		fmt.Fprintf(os.Stderr, "reindex: migrated data directory to %s in %s\n", status.DesiredVersion, time.Since(start).Round(time.Millisecond))
	}

	// Same setup as the daemon (see daemon.Load), minus the network.
	idx := blob.OpenIndexPendingReindex(store.DB(), logging.New("seed/indexing", base.LogLevel))
	idx.SetDeriveDocFields(documentsv3.DeriveDocFields)
	idx.SetOffline(true)
	defer idx.Domains.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		defer close(done)
		reportReindexProgress(ctx, os.Stderr, idx, opts.ProgressInterval)
	}()

	reindexStart := time.Now()

	if opts.ProfileDir != "" {
		fmt.Fprintf(os.Stderr, "reindex: writing profiles to %s\n", opts.ProfileDir)
		perr := pprofx.Do(ctx, "db.reindex", opts.ProfileDir, func(ctx context.Context) {
			err = idx.Reindex(ctx)
		})
		err = errors.Join(err, perr)
	} else {
		err = idx.Reindex(ctx)
	}

	cancel()
	<-done

	if err != nil {
		return fmt.Errorf("reindex failed after %s: %w", time.Since(reindexStart).Round(time.Millisecond), err)
	}

	info := idx.ReindexInfo()
	fmt.Fprintf(os.Stderr, "reindex: done, indexed %d blobs in %s\n", info.BlobsIndexed, time.Since(reindexStart).Round(time.Millisecond))

	return nil
}

// confirm asks a yes/no question on out and reads the answer from in.
// It refuses to guess when in is not an interactive terminal.
func confirm(in *os.File, out io.Writer, question string) (bool, error) {
	if !term.IsTerminal(int(in.Fd())) { //nolint:gosec // File descriptors fit into int.
		return false, errors.New("confirmation required but stdin is not a terminal: pass -allow-migrations to apply them")
	}

	r := bufio.NewReader(in)
	for {
		fmt.Fprintf(out, "%s [y/N]: ", question)

		line, err := r.ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return false, err
		}

		switch strings.ToLower(strings.TrimSpace(line)) {
		case "y", "yes":
			return true, nil
		case "", "n", "no":
			return false, nil
		}

		if errors.Is(err, io.EOF) {
			return false, nil
		}
	}
}

type reindexInfoer interface {
	ReindexInfo() blob.ReindexInfo
}

// reportReindexProgress prints the reindex progress every interval until ctx is done.
func reportReindexProgress(ctx context.Context, out io.Writer, idx reindexInfoer, interval time.Duration) {
	start := time.Now()
	var lastIndexed int64

	lastTime := start

	t := time.NewTimer(interval)
	defer t.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}

		now := time.Now()
		info := idx.ReindexInfo()
		elapsed := now.Sub(start).Round(time.Second)

		switch {
		case info.BlobsTotal == 0:
			fmt.Fprintf(out, "reindex: preparing (clearing derived tables), elapsed %s\n", elapsed)
		case info.BlobsIndexed >= info.BlobsTotal:
			fmt.Fprintf(out, "reindex: %d/%d blobs indexed, finalizing (deriving document fields), elapsed %s\n",
				info.BlobsIndexed, info.BlobsTotal, elapsed)
		default:
			rate := float64(info.BlobsIndexed-lastIndexed) / now.Sub(lastTime).Seconds()

			eta := "unknown"
			if rate > 0 {
				eta = time.Duration(float64(info.BlobsTotal-info.BlobsIndexed) / rate * float64(time.Second)).Round(time.Second).String()
			}

			fmt.Fprintf(out, "reindex: %5.1f%% %d/%d blobs, %.0f blobs/s, ETA %s, elapsed %s\n",
				100*float64(info.BlobsIndexed)/float64(info.BlobsTotal), info.BlobsIndexed, info.BlobsTotal, rate, eta, elapsed)
		}

		lastIndexed = info.BlobsIndexed
		lastTime = now
		t.Reset(interval)
	}
}
