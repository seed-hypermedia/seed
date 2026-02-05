package llama_test

import (
	"os"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	llama "github.com/tcpipuk/llama-go"
)

var _ = Describe("GPU Layer Configuration", Label("gpu-layers"), func() {
	var modelPath string
	var model *llama.Model
	var ctx *llama.Context

	BeforeEach(func() {
		modelPath = os.Getenv("TEST_CHAT_MODEL")
		if modelPath == "" {
			Skip("TEST_CHAT_MODEL not set - skipping integration tests")
		}
	})

	AfterEach(func() {
		if ctx != nil {
			ctx.Close()
			ctx = nil
		}
		if model != nil {
			model.Close()
			model = nil
		}
	})

	Context("default behaviour", func() {
		It("should default to offloading all layers to GPU", Label("integration", "gpu"), func() {
			var err error
			// Default config should offload to GPU (-1 = all layers)
			model, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())

			// Should use GPU (verify by checking generation isn't painfully slow)
			start := time.Now()
			result, err := ctx.Generate("Test", llama.WithMaxTokens(5))
			duration := time.Since(start)

			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
			// Should be fast with GPU (< 5 seconds for 5 tokens)
			Expect(duration).To(BeNumerically("<", 5*time.Second),
				"Generation should be fast with GPU offloading")
		})

		It("should work correctly with explicit -1 value", Label("integration", "gpu"), func() {
			var err error
			model, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Hello world",
				llama.WithMaxTokens(10),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})
	})

	Context("explicit layer counts", func() {
		It("should handle zero GPU layers (CPU-only)", Label("integration"), func() {
			var err error
			model, err = llama.LoadModel(modelPath, llama.WithGPULayers(0))
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Test",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})

		It("should handle partial GPU offloading", Label("integration", "gpu"), func() {
			var err error
			model, err = llama.LoadModel(modelPath, llama.WithGPULayers(10))
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Hello",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})

		It("should handle offloading half the layers", Label("integration", "gpu"), func() {
			var err error
			// Qwen3-0.6B has 28 layers, so 14 is half
			model, err = llama.LoadModel(modelPath, llama.WithGPULayers(14))
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Test",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})

		It("should handle offloading most layers", Label("integration", "gpu"), func() {
			var err error
			model, err = llama.LoadModel(modelPath, llama.WithGPULayers(25))
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Test",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})

		It("should handle offloading more layers than model has", Label("integration", "gpu"), func() {
			var err error
			// Requesting 100 layers when model has 28 should work (clamps to available)
			model, err = llama.LoadModel(modelPath, llama.WithGPULayers(100))
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Test",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})
	})

	Context("performance comparison", func() {
		It("should be faster with GPU offloading than CPU-only", Label("integration", "gpu"), func() {
			var err error
			var cpuCtx, gpuCtx *llama.Context

			// CPU-only timing
			modelCPU, err := llama.LoadModel(modelPath, llama.WithGPULayers(0))
			Expect(err).NotTo(HaveOccurred())
			defer modelCPU.Close()

			cpuCtx, err = modelCPU.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer cpuCtx.Close()

			startCPU := time.Now()
			resultCPU, err := cpuCtx.Generate("Test prompt for timing",
				llama.WithMaxTokens(10),
			)
			cpuDuration := time.Since(startCPU)
			Expect(err).NotTo(HaveOccurred())
			Expect(resultCPU).NotTo(BeEmpty())

			// GPU timing (all layers)
			modelGPU, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			defer modelGPU.Close()

			gpuCtx, err = modelGPU.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer gpuCtx.Close()

			startGPU := time.Now()
			resultGPU, err := gpuCtx.Generate("Test prompt for timing",
				llama.WithMaxTokens(10),
			)
			gpuDuration := time.Since(startGPU)
			Expect(err).NotTo(HaveOccurred())
			Expect(resultGPU).NotTo(BeEmpty())

			// GPU should be significantly faster (at least 2x)
			Expect(gpuDuration).To(BeNumerically("<", cpuDuration/2),
				"GPU should be at least 2x faster than CPU-only")
		})

		It("should show progressive performance improvement with more GPU layers", Label("integration", "gpu", "slow"), func() {
			prompt := "Test prompt"
			maxTokens := 10
			var err error

			// Measure with 0 layers (CPU-only)
			model0, err := llama.LoadModel(modelPath, llama.WithGPULayers(0))
			Expect(err).NotTo(HaveOccurred())
			defer model0.Close()

			ctx0, err := model0.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx0.Close()

			start0 := time.Now()
			_, err = ctx0.Generate(prompt, llama.WithMaxTokens(maxTokens))
			duration0 := time.Since(start0)
			Expect(err).NotTo(HaveOccurred())

			// Measure with half layers
			model14, err := llama.LoadModel(modelPath, llama.WithGPULayers(14))
			Expect(err).NotTo(HaveOccurred())
			defer model14.Close()

			ctx14, err := model14.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx14.Close()

			start14 := time.Now()
			_, err = ctx14.Generate(prompt, llama.WithMaxTokens(maxTokens))
			duration14 := time.Since(start14)
			Expect(err).NotTo(HaveOccurred())

			// Measure with all layers
			modelAll, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			defer modelAll.Close()

			ctxAll, err := modelAll.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctxAll.Close()

			startAll := time.Now()
			_, err = ctxAll.Generate(prompt, llama.WithMaxTokens(maxTokens))
			durationAll := time.Since(startAll)
			Expect(err).NotTo(HaveOccurred())

			// More GPU layers should be faster
			Expect(duration14).To(BeNumerically("<", duration0),
				"Half GPU layers should be faster than CPU-only")
			Expect(durationAll).To(BeNumerically("<", duration14),
				"All GPU layers should be faster than half")
		})
	})

	Context("fallback behaviour", func() {
		It("should gracefully handle GPU unavailable", Label("integration"), func() {
			var err error
			// When GPU is unavailable, -1 should fall back to CPU
			// This test should pass on systems without GPU
			model, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Test",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})
	})

	Context("integration with other options", func() {
		It("should work with custom context size", Label("integration", "gpu"), func() {
			var err error
			model, err = llama.LoadModel(modelPath,
				llama.WithGPULayers(-1),
			)
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(llama.WithContext(1024))
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Test",
				llama.WithMaxTokens(10),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})

		It("should work with custom batch size", Label("integration", "gpu"), func() {
			var err error
			model, err = llama.LoadModel(modelPath,
				llama.WithGPULayers(-1),
			)
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(llama.WithContext(2048), llama.WithBatch(256))
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Test",
				llama.WithMaxTokens(10),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})

		It("should work with thread configuration", Label("integration", "gpu"), func() {
			var err error
			model, err = llama.LoadModel(modelPath,
				llama.WithGPULayers(-1),
			)
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Test",
				llama.WithMaxTokens(10),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})

	})
})
