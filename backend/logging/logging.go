// Package logging is a convenience wrapper around IPFS logging package, which itself is a convenience
// package around Zap logger. This package disourages usage of global loggers though, and allows to create
// named loggers specifying their logging level in one call.
package logging

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/ipfs/go-log/v2"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"golang.org/x/term"
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

// ListLogNames of the underlying IPFS global logger.
func ListLogNames() []string {
	logs := log.GetSubsystems()
	sort.Strings(logs)
	return logs
}

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
