//go:build gpu

package llama

/*
#cgo LDFLAGS: -L./ -framework Accelerate -framework Foundation -framework Metal -framework MetalKit -framework MetalPerformanceShaders
*/
import "C"
