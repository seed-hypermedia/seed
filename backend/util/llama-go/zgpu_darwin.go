//go:build gpu

// Always include Metal LDFLAGS on Darwin since libggml.a is compiled with Metal support.
// The linker needs these even for non-GPU test runs.
package llama

/*
#cgo LDFLAGS: -L./ -framework Accelerate -framework Foundation -framework Metal -framework MetalKit -framework MetalPerformanceShaders
*/
import "C"
