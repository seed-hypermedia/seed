//go:build gpu

// Always include Vulkan LDFLAGS on Linux since libggml.a is compiled with Vulkan support.
// The linker needs these even for non-GPU test runs.
package llama

/*
#cgo LDFLAGS: -L./ -lggml-vulkan -lvulkan
*/
import "C"
