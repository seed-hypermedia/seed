//go:build gpu && windows

// Always include Vulkan LDFLAGS on Windows since libggml.a is compiled with Vulkan support.
// The linker needs these even for non-GPU test runs.
// Built with MinGW for ABI compatibility with CGO.
package llama

/*
#cgo LDFLAGS: -L./ -lggml-vulkan -lvulkan-1
#cgo CXXFLAGS: -std=c++17
*/
import "C"
