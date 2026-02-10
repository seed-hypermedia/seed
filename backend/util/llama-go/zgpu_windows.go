// GPU support is enabled by default. Pass -tags cpu to build without GPU acceleration.
//go:build !cpu && windows

// Include Vulkan LDFLAGS on Windows for GPU acceleration.
// Built with MinGW for ABI compatibility with CGO.
// Requires -lgomp for OpenMP support used by ggml-cpu.
package llama

/*
#cgo LDFLAGS: -L./ -lggml-vulkan -lvulkan-1 -Wl,-Bstatic -lgomp -lwinpthread -Wl,-Bdynamic
#cgo CXXFLAGS: -std=c++17
*/
import "C"
