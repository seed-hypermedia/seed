// Package pprofx provides sane defaults for pprof-related settings.
package pprofx

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"runtime/pprof"
	"runtime/trace"
)

// UseRecommendedSettings configures runtime settings for pprof-related features.
// These settings are recommended in this video by a DataDog profiling expert: https://www.youtube.com/watch?v=7hg4T2Qqowk.
func UseRecommendedSettings() {
	runtime.SetBlockProfileRate(10000)
	runtime.SetMutexProfileFraction(10)
}

// Do runs fn with pprof labels set to "op=name", maximum granularity for block and mutex profiles,
// and writes all profile snapshots to dirname.
// It restores runtime settings to recommended values after completion (calling [UseRecommendedSettings]).
// If you need different runtime settings, you must set them yourself after this function returns.
func Do(ctx context.Context, name string, dirname string, fn func(context.Context)) error {
	if err := os.MkdirAll(dirname, 0750); err != nil {
		return fmt.Errorf("failed to create profile directory: %w", err)
	}

	runtime.SetBlockProfileRate(1)
	runtime.SetMutexProfileFraction(1)

	traceFile, err := os.Create(filepath.Join(dirname, "trace.out"))
	if err != nil {
		return fmt.Errorf("failed to create trace file: %w", err)
	}
	defer traceFile.Close()

	if err := trace.Start(traceFile); err != nil {
		return fmt.Errorf("failed to start trace: %w", err)
	}

	cpuFile, err := os.Create(filepath.Join(dirname, "cpu.prof"))
	if err != nil {
		return fmt.Errorf("failed to create cpu profile file: %w", err)
	}
	defer cpuFile.Close()

	if err := pprof.StartCPUProfile(cpuFile); err != nil {
		return fmt.Errorf("failed to start cpu profile: %w", err)
	}

	labels := pprof.Labels("op", name)
	pprof.Do(ctx, labels, fn)

	pprof.StopCPUProfile()
	trace.Stop()

	// Call GC for accurate heap profile.
	runtime.GC()

	for _, p := range pprof.Profiles() {
		profilePath := filepath.Join(dirname, p.Name()+".prof")
		f, err := os.Create(profilePath)
		if err != nil {
			return fmt.Errorf("failed to create profile file %s: %w", profilePath, err)
		}
		if err := p.WriteTo(f, 0); err != nil {
			err = errors.Join(err, f.Close())
			return fmt.Errorf("failed to write profile %s: %w", p.Name(), err)
		}
		if err := f.Close(); err != nil {
			return fmt.Errorf("failed to close profile file %s: %w", profilePath, err)
		}
	}

	UseRecommendedSettings()

	return nil
}
