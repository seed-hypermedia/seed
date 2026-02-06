//go:build cublas
// +build cublas

// This file provides CUDA/cuBLAS GPU acceleration support when built with the
// 'cublas' build tag. It links against NVIDIA's CUDA libraries for GPU-accelerated
// inference on NVIDIA GPUs.
//
// Build with: go build -tags cublas
//
// Requires CUDA toolkit installed with cuBLAS and CUDA runtime libraries.
package llama

/*
#cgo CPPFLAGS: -DGGML_USE_CUDA
#cgo LDFLAGS: -lggml-cuda -lcublas -lcudart -L/usr/local/cuda/lib64/
*/
import "C"
