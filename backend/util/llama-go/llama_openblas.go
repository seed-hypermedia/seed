//go:build openblas
// +build openblas

// This file provides OpenBLAS CPU acceleration support when built with the
// 'openblas' build tag. It links against the OpenBLAS library for optimised
// CPU-based matrix operations, significantly improving inference performance
// on CPU-only systems.
//
// Build with: go build -tags openblas
//
// Requires OpenBLAS library installed on the system.
package llama

/*
#cgo LDFLAGS: -lopenblas
*/
import "C"
