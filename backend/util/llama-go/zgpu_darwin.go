// GPU support is enabled by default. Pass -tags cpu to build without GPU acceleration.
//go:build !cpu

// Include Metal LDFLAGS on Darwin for GPU acceleration.
package llama

/*
#cgo LDFLAGS: -L./ -lggml-metal -lggml-blas -framework Accelerate -framework Foundation -framework Metal -framework MetalKit -framework MetalPerformanceShaders
*/
import "C"
