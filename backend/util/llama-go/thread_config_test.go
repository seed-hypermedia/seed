package llama_test

import (
	"os"
	"runtime"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	llama "github.com/tcpipuk/llama-go"
)

var _ = Describe("Thread Configuration", Label("thread-config"), func() {
	var (
		model     *llama.Model
		ctx       *llama.Context
		modelPath string
	)

	BeforeEach(func() {
		modelPath = os.Getenv("TEST_CHAT_MODEL")
		if modelPath == "" {
			Skip("TEST_CHAT_MODEL not set - skipping integration tests")
		}

		var err error
		model, err = llama.LoadModel(modelPath, llama.WithGPULayers(0))
		Expect(err).NotTo(HaveOccurred())
	})

	AfterEach(func() {
		if ctx != nil {
			ctx.Close()
		}
		if model != nil {
			model.Close()
		}
	})

	Context("WithThreads", func() {
		It("should respect custom thread count", Label("integration"), func() {
			var err error
			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			// Should complete without hanging (threads configured correctly)
			result, err := ctx.Generate("Hello",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})

		It("should use all CPU cores by default", Label("integration"), func() {
			// Default should use runtime.NumCPU() threads
			var err error
			ctx, err = model.NewContext(
				llama.WithContext(2048),
			)
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Hello",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})

		It("should handle single thread configuration", Label("integration"), func() {
			var err error
			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(1),
			)
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Test",
				llama.WithMaxTokens(3),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})

		It("should handle maximum thread configuration", Label("integration"), func() {
			maxThreads := runtime.NumCPU() * 2
			var err error
			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(maxThreads),
			)
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Test",
				llama.WithMaxTokens(3),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})
	})

	Context("WithThreadsBatch", func() {
		It("should respect custom batch thread count", Label("integration"), func() {
			var err error
			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
				llama.WithThreadsBatch(8),
			)
			Expect(err).NotTo(HaveOccurred())

			// Should complete without hanging (batch threads configured correctly)
			result, err := ctx.Generate("Hello",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})

		It("should use same as WithThreads by default", Label("integration"), func() {
			// When WithThreadsBatch is 0 (default), should use same as WithThreads
			var err error
			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(6),
				llama.WithThreadsBatch(0), // Explicit default
			)
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Test",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})

		It("should allow different batch and prompt thread counts", Label("integration"), func() {
			var err error
			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(2),
				llama.WithThreadsBatch(8),
			)
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Test",
				llama.WithMaxTokens(10),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})
	})

	Context("thread configuration with GPU", func() {
		It("should work with GPU offloading enabled", Label("integration", "gpu"), func() {
			gpuModel, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			defer gpuModel.Close()

			gpuCtx, err := gpuModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
				llama.WithThreadsBatch(8),
			)
			Expect(err).NotTo(HaveOccurred())
			defer gpuCtx.Close()

			result, err := gpuCtx.Generate("Hello",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})

		It("should work with partial GPU offloading", Label("integration", "gpu"), func() {
			gpuModel, err := llama.LoadModel(modelPath, llama.WithGPULayers(10))
			Expect(err).NotTo(HaveOccurred())
			defer gpuModel.Close()

			gpuCtx, err := gpuModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
				llama.WithThreadsBatch(6),
			)
			Expect(err).NotTo(HaveOccurred())
			defer gpuCtx.Close()

			result, err := gpuCtx.Generate("Test",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})
	})

	Context("edge cases", func() {
		It("should handle batch threads less than prompt threads", Label("integration"), func() {
			var err error
			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(8),
				llama.WithThreadsBatch(4),
			)
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Test",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})

		It("should handle batch threads greater than prompt threads", Label("integration"), func() {
			var err error
			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(2),
				llama.WithThreadsBatch(16),
			)
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Test",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})

		It("should handle equal prompt and batch thread counts", Label("integration"), func() {
			var err error
			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(6),
				llama.WithThreadsBatch(6),
			)
			Expect(err).NotTo(HaveOccurred())

			result, err := ctx.Generate("Test",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})
	})
})
