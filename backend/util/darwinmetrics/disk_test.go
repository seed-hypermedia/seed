//go:build darwin
// +build darwin

package darwinmetrics

import (
	"os"
	"testing"
)

func BenchmarkTestDiskMetrics(b *testing.B) {
	pid := os.Getpid()
	for b.Loop() {
		_, err := getDiskMetrics(pid)
		if err != nil {
			b.Fatal(err)
		}
	}
}
