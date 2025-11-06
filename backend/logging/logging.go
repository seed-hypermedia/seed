// Package logging is a convenience wrapper around IPFS logging package, which itself is a convenience
// package around Zap logger. This package disourages usage of global loggers though, and allows to create
// named loggers specifying their logging level in one call.
package logging

import (
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/ipfs/go-log/v2"
	"github.com/libp2p/go-libp2p/gologshim"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"golang.org/x/term"

	_ "unsafe" //nolint:revive
)

func init() {
	// Compatibility with IPFS's logging library.
	envfmt := strings.TrimSpace(strings.ToLower(os.Getenv("GOLOG_LOG_FMT")))

	// Overriding the primary logger of the IPFS's go-log package, to have full control of the output.

	cfg := zap.NewProductionEncoderConfig()
	cfg.MessageKey = "msg"
	cfg.LevelKey = "lvl"
	cfg.TimeKey = "ts"
	cfg.NameKey = "log"
	cfg.EncodeTime = func(t time.Time, enc zapcore.PrimitiveArrayEncoder) {
		t = t.UTC()
		enc.AppendString(t.Format(time.RFC3339))
	}

	var enc zapcore.Encoder

	// If stderr is not a terminal, we use JSON encoding for logs.
	// The fields and encodings are the same we use in our Electron app.
	if !term.IsTerminal(int(os.Stderr.Fd())) || envfmt == "json" {
		enc = zapcore.NewJSONEncoder(cfg)
	} else {
		cfg.EncodeLevel = zapcore.CapitalColorLevelEncoder
		enc = zapcore.NewConsoleEncoder(cfg)
	}

	log.SetPrimaryCore(zapcore.NewCore(enc, os.Stderr, zap.NewAtomicLevelAt(zapcore.DebugLevel)))

	gologshim.SetDefaultHandler(log.SlogHandler())
	slog.SetDefault(NewSlog("slog-global", "info"))
}

// New creates a new named logger with the specified level.
// If logger was created before it will just set the level.
func New(subsystem, level string) *zap.Logger {
	l := log.Logger(subsystem).Desugar()

	if err := log.SetLogLevel(subsystem, level); err != nil {
		panic(err)
	}

	return l
}

// NewSlog creates a new slog logger, which is wired through the same go-log pipeline.
func NewSlog(subsystem, level string) *slog.Logger {
	l := gologshim.Logger(subsystem)

	if err := log.SetLogLevel(subsystem, level); err != nil {
		panic(err)
	}

	return l
}

// SetLogLevel sets the level on the named logger. It may panic
// in case of a non-existing name.
func SetLogLevel(subsystem, level string) {
	if err := log.SetLogLevel(subsystem, level); err != nil {
		panic(fmt.Errorf("%s %s %w", subsystem, level, err))
	}
}

// SetLogLevelErr is like [SetLogLevel] but returns an error instead of panic.
func SetLogLevelErr(subsystem, level string) error {
	return log.SetLogLevel(subsystem, level)
}

// Config is an alias for IPFS logging config. Exported for convenience.
type Config = log.Config

// Output formats.
const (
	ColorizedOutput = log.ColorizedOutput
	PlaintextOutput = log.PlaintextOutput
	JSONOutput      = log.JSONOutput
)

// Setup global parent logger with the specified config.
func Setup(cfg Config) {
	log.SetupLogging(cfg)
}

// DefaultConfig creates a default logging config.
func DefaultConfig() Config {
	return Config{
		Format: log.ColorizedOutput,
		Stderr: true,
		Level:  log.LevelError,
		Labels: map[string]string{},
	}
}

// We are doing this ugly hack to access some of the private globals from the go-log package,
// because since the introduction of the github.com/libp2p/go-libp2p/gologshim, and the switch in libp2p
// from zap to the standard slog package, some things in go-log package stopped working like before.
// In particular, loggers created with gologshim are not stored as loggers themselves, but only their levels,
// which means the go-log's GetSubsystems() function won't list the loggers created with the shim.
//
// So, in order to render truly all available subsystems, we have to access the levels map, which is not exported by go-log in any way.
// It's important that any access to those linked private variables is guarded by the loggerMutex.

//go:linkname loggerMutex github.com/ipfs/go-log/v2.loggerMutex
var loggerMutex sync.RWMutex

//go:linkname loggers github.com/ipfs/go-log/v2.loggers
var loggers map[string]*zap.SugaredLogger

//go:linkname levels github.com/ipfs/go-log/v2.levels
var levels map[string]zap.AtomicLevel

// GetGlobalConfig returns globel logging configuration.
// It's pain that there's no way to not use global here.
func GetGlobalConfig() log.Config {
	return log.GetConfig()
}

// LevelToString returns string representation of the log level, to avoid
// callers depending on the zapcore package.
func LevelToString(l log.LogLevel) string {
	return zapcore.Level(l).String()
}

// GetLogLevel returns the current log level for the given logger.
func GetLogLevel(subsystem string) zapcore.Level {
	return log.Logger(subsystem).Level()
}
