// GPU support is enabled by default. Pass -tags cpu to build without GPU acceleration.
//go:build !cpu

// Include Vulkan LDFLAGS on Linux for GPU acceleration.
package llama

/*
#cgo LDFLAGS: -L./ -lggml-vulkan -lvulkan
*/
import "C"
