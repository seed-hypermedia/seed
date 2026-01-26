//go:build gpu

package llama

/*
#cgo LDFLAGS: -L./ -lggml-vulkan -lvulkan
*/
import "C"
