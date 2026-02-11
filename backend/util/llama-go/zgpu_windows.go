// GPU support is enabled by default. Pass -tags cpu to build without GPU acceleration.
//go:build !cpu && windows

// Include Vulkan LDFLAGS on Windows for GPU acceleration.
// Built with an MSVC-compatible toolchain for Windows CGO builds.
package llama

/*
#cgo LDFLAGS: -L./ -lggml-vulkan -lvulkan-1
#cgo CXXFLAGS: -std=c++17
*/
import "C"
