//go:build !linux

package storage

import "go.uber.org/zap"

// maybeDisableCOW is a no-op on non-Linux platforms.
// See nocow_linux.go for what it does on btrfs and why.
func maybeDisableCOW(dir string, log *zap.Logger) {}
