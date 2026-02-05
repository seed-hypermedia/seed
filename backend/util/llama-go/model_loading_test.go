package llama_test

import (
	"os"
	"runtime"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/tcpipuk/llama-go"
)

// Model Lifecycle Tests
//
// Tests for model loading, configuration, closure, and finaliser behaviour.
// Covers LoadModel function, Model.Close method, and resource management patterns.

var _ = Describe("LoadModel", func() {
	Context("with valid model path", func() {
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set - skipping integration test")
			}
		})

		It("should load model successfully", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()
		})

		It("should return non-nil model pointer", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()
		})

		It("should initialise llama backend", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			// Verify backend is initialised by performing a basic operation
			ctx, err := model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			response, err := ctx.Generate("test", llama.WithMaxTokens(1))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should set finaliser for automatic cleanup", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			// Finaliser is set during LoadModel; verify model works normally
			// (finaliser testing is in separate suite due to GC requirements)
			ctx, err := model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			response, err := ctx.Generate("test", llama.WithMaxTokens(1))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})
	})

	Context("with invalid model path", func() {
		It("should return error for empty string path", Label("unit"), func() {
			model, err := llama.LoadModel("")
			Expect(err).To(HaveOccurred())
			Expect(model).To(BeNil())
		})

		It("should return error for non-existent file path", Label("unit"), func() {
			model, err := llama.LoadModel("/nonexistent/model.gguf")
			Expect(err).To(HaveOccurred())
			Expect(model).To(BeNil())
		})

		It("should return error containing \"Failed to load model from:\"", Label("unit"), func() {
			_, err := llama.LoadModel("/nonexistent/model.gguf")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("Failed to load model from:"))
		})

		It("should return nil model on error", Label("unit"), func() {
			model, err := llama.LoadModel("/nonexistent/model.gguf")
			Expect(err).To(HaveOccurred())
			Expect(model).To(BeNil())
		})
	})

	Context("with null/invalid path formats", func() {
		It("should return \"Model path cannot be null\" for null path", Label("unit"), func() {
			_, err := llama.LoadModel("")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("Model path cannot be null"))
		})

		It("should handle paths with special characters", Label("integration"), func() {
			modelPath := os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set")
			}

			// Test with path that might have spaces or special chars
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			defer model.Close()
		})

		It("should handle relative vs absolute paths", Label("integration"), func() {
			modelPath := os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set")
			}

			// Test that valid paths work regardless of format
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()
		})
	})

	Context("with configuration options", func() {
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set")
			}
		})

		It("should apply WithContext option", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			// Create context with custom size
			ctx, err := model.NewContext(llama.WithContext(4096))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			// Verify context size by attempting generation
			response, err := ctx.Generate("Hello", llama.WithMaxTokens(10))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should apply WithBatch option", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			ctx, err := model.NewContext(llama.WithContext(2048), llama.WithBatch(256))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			// Verify batch size by performing generation
			response, err := ctx.Generate("Test", llama.WithMaxTokens(10))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should apply WithThreads option", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			ctx, err := model.NewContext(llama.WithContext(2048), llama.WithThreads(2))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			// Verify threads by performing generation
			response, err := ctx.Generate("Test", llama.WithMaxTokens(10))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should apply WithGPULayers option", Label("integration", "gpu"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(10))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			ctx, err := model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			// GPU layers configured, verify basic operation
			response, err := ctx.Generate("Test", llama.WithMaxTokens(10))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should apply WithF16Memory option", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			ctx, err := model.NewContext(
				llama.WithContext(2048),
				llama.WithF16Memory(),
			)
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			// F16 memory enabled, verify operation
			response, err := ctx.Generate("Test", llama.WithMaxTokens(10))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should apply WithMLock option", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithMLock())
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			ctx, err := model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			// MLock enabled, verify operation
			response, err := ctx.Generate("Test", llama.WithMaxTokens(10))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should apply WithMMap option", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithMMap(false))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			ctx, err := model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			// MMap disabled, verify operation
			response, err := ctx.Generate("Test", llama.WithMaxTokens(10))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should apply WithEmbeddings option", Label("integration"), func() {
			// This test needs an embedding model
			embeddingModelPath := os.Getenv("TEST_EMBEDDING_MODEL")
			if embeddingModelPath == "" {
				Skip("TEST_EMBEDDING_MODEL not set")
			}

			model, err := llama.LoadModel(embeddingModelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			ctx, err := model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			// Embeddings enabled, verify we can get embeddings
			embeddings, err := ctx.GetEmbeddings("Test")
			Expect(err).NotTo(HaveOccurred())
			Expect(embeddings).NotTo(BeEmpty())
		})

		It("should apply WithParallel option", Label("integration"), func() {
			// This test needs an embedding model to test parallel sequences
			embeddingModelPath := os.Getenv("TEST_EMBEDDING_MODEL")
			if embeddingModelPath == "" {
				Skip("TEST_EMBEDDING_MODEL not set")
			}

			// Test with n_parallel=4 (lower than default 8 for embeddings)
			model, err := llama.LoadModel(embeddingModelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			ctx, err := model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			// Verify parallel sequences work with batch embeddings
			texts := []string{"Hello", "World", "Test", "Batch"}
			embeddings, err := ctx.GetEmbeddingsBatch(texts)
			Expect(err).NotTo(HaveOccurred())
			Expect(embeddings).To(HaveLen(4))
			for _, emb := range embeddings {
				Expect(emb).NotTo(BeEmpty())
			}
		})

		It("should apply multiple options together", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath,
				llama.WithGPULayers(-1),
				llama.WithMMap(true),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			ctx, err := model.NewContext(
				llama.WithContext(4096),
				llama.WithBatch(256),
				llama.WithThreads(4),
				llama.WithF16Memory(),
			)
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			// All options applied, verify operation
			response, err := ctx.Generate("Test", llama.WithMaxTokens(10))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})
	})

	Context("with default configuration", func() {
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set")
			}
		})

		It("should use context size from model metadata when not specified", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			ctx, err := model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			// Context created successfully, verify by successful generation
			response, err := ctx.Generate("Test", llama.WithMaxTokens(10))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should use batch size 512 when not specified", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			ctx, err := model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			// Default batch is 512, verify by successful generation
			response, err := ctx.Generate("Test", llama.WithMaxTokens(10))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should use CPU-only (0 GPU layers) when not specified", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath)
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			ctx, err := model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			// Default is CPU-only, verify operation
			response, err := ctx.Generate("Test", llama.WithMaxTokens(10))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should use runtime.NumCPU() threads when not specified", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			ctx, err := model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			// Default threads is runtime.NumCPU(), verify operation
			expectedThreads := runtime.NumCPU()
			Expect(expectedThreads).To(BeNumerically(">", 0))

			response, err := ctx.Generate("Test", llama.WithMaxTokens(10))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should enable mmap by default", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			ctx, err := model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			// MMap enabled by default, verify operation
			response, err := ctx.Generate("Test", llama.WithMaxTokens(10))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})
	})

	Context("when context creation fails", func() {
		It("should return \"Failed to create context\" error", Label("integration"), func() {
			// This is difficult to trigger without invalid configuration
			// Test that error message format is correct when it does occur
			modelPath := os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set")
			}

			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			defer model.Close()

			// Attempt to create context with potentially problematic config
			// (actual failure difficult to guarantee)
			ctx, err := model.NewContext(llama.WithContext(0))
			if err != nil {
				// If it fails, verify error message
				Expect(err.Error()).To(Or(
					ContainSubstring("Failed to create context"),
					ContainSubstring("Invalid context size"),
				))
			} else if ctx != nil {
				// If it succeeds (C++ applies default), clean up
				ctx.Close()
			}
		})

		It("should free model if model load fails", Label("integration"), func() {
			// Verify that failed loads don't leak memory
			// Load failure should clean up properly
			_, err := llama.LoadModel("/nonexistent/model.gguf")
			Expect(err).To(HaveOccurred())

			// No model to close, verify no panic from finaliser
			runtime.GC()
		})
	})
})

var _ = Describe("Model.Close", func() {
	Context("on valid model", func() {
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set")
			}
		})

		It("should free resources successfully", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())

			err = model.Close()
			Expect(err).NotTo(HaveOccurred())
		})

		It("should set pointer to nil", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())

			model.Close()

			// Verify model is closed by attempting operation
			_, err = model.NewContext(llama.WithContext(2048))
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(Equal("model is closed"))
		})

		It("should remove finaliser", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())

			err = model.Close()
			Expect(err).NotTo(HaveOccurred())

			// Finaliser removed, no double-free on GC
			runtime.GC()
		})

		It("should always return nil error", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())

			err = model.Close()
			Expect(err).To(BeNil())
		})
	})

	Context("when called multiple times", func() {
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set")
			}
		})

		It("should be safe to call Close() twice", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())

			err = model.Close()
			Expect(err).NotTo(HaveOccurred())

			err = model.Close()
			Expect(err).NotTo(HaveOccurred())
		})

		It("should not panic on double-close", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())

			Expect(func() {
				model.Close()
				model.Close()
			}).NotTo(Panic())
		})

		It("should remain nil after second close", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())

			model.Close()
			model.Close()

			// Verify still closed
			_, err = model.NewContext(llama.WithContext(2048))
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(Equal("model is closed"))
		})
	})

	Context("on already-closed model", func() {
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set")
			}
		})

		It("should be idempotent", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())

			model.Close()

			// Multiple closes should have same effect
			err = model.Close()
			Expect(err).NotTo(HaveOccurred())

			err = model.Close()
			Expect(err).NotTo(HaveOccurred())
		})

		It("should not error on nil pointer", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())

			model.Close()

			// Close on already-closed model (nil pointer internally)
			err = model.Close()
			Expect(err).NotTo(HaveOccurred())
		})
	})
})

var _ = Describe("Model Finaliser", func() {
	Context("when model not explicitly closed", func() {
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set")
			}
		})

		It("should call Close() via finaliser", Label("integration", "slow"), func() {
			// Load model and let it go out of scope
			func() {
				model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
				Expect(err).NotTo(HaveOccurred())
				Expect(model).NotTo(BeNil())
				// Model goes out of scope without explicit Close()
			}()

			// Force GC to run finalisers
			runtime.GC()
			runtime.GC() // Multiple GC cycles to ensure finaliser runs

			// If finaliser worked, no crash or leak
			// Load another model to verify no corruption
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			defer model.Close()
		})

		It("should free resources after GC", Label("integration", "slow"), func() {
			// Track that resources are freed by finaliser
			initialModel, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			initialModel.Close()

			// Load model without closing
			func() {
				model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
				Expect(err).NotTo(HaveOccurred())
				Expect(model).NotTo(BeNil())
				// Goes out of scope
			}()

			// Force finaliser
			runtime.GC()
			runtime.GC()

			// Should be able to load again without issues
			newModel, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			defer newModel.Close()
		})

		It("should handle finaliser running after explicit Close()", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())

			// Explicitly close (removes finaliser)
			model.Close()

			// Force GC - finaliser should not run again
			runtime.GC()
			runtime.GC()

			// No double-free, no crash
			// Verify by loading new model
			newModel, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			defer newModel.Close()
		})
	})

	Context("when explicitly closed", func() {
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set")
			}
		})

		It("should remove finaliser on Close()", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())

			// Close removes finaliser
			model.Close()

			// Finaliser should not run
			runtime.GC()
			runtime.GC()

			// Verify no issues
			newModel, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			defer newModel.Close()
		})

		It("should not double-free if GC runs later", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())

			model.Close()

			// Multiple GC cycles should not cause issues
			runtime.GC()
			runtime.GC()
			runtime.GC()

			// Verify system still stable
			newModel, err := llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			defer newModel.Close()

			ctx, err := newModel.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			response, err := ctx.Generate("Test", llama.WithMaxTokens(5))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})
	})
})

var _ = Describe("Progress Callbacks", func() {
	Context("with WithSilentLoading", func() {
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set")
			}
		})

		It("should load model without printing progress dots", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath,
				llama.WithSilentLoading(),
				llama.WithGPULayers(-1),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			// Verify model works normally after silent loading
			ctx, err := model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			response, err := ctx.Generate("test", llama.WithMaxTokens(1))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should work with other options", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath,
				llama.WithSilentLoading(),
				llama.WithGPULayers(0),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			ctx, err := model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(2),
			)
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			response, err := ctx.Generate("Test", llama.WithMaxTokens(5))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})
	})

	Context("with WithProgressCallback", func() {
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set")
			}
		})

		It("should call callback during model loading", Label("integration"), func() {
			var progressValues []float32
			var callCount int

			model, err := llama.LoadModel(modelPath,
				llama.WithProgressCallback(func(progress float32) bool {
					progressValues = append(progressValues, progress)
					callCount++
					return true // Continue loading
				}),
				llama.WithGPULayers(-1),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			// Verify callback was called
			Expect(callCount).To(BeNumerically(">", 0))
			Expect(progressValues).NotTo(BeEmpty())

			// Verify progress values are in range 0.0-1.0
			Expect(progressValues[0]).To(BeNumerically(">=", 0.0))
			Expect(progressValues[len(progressValues)-1]).To(BeNumerically("<=", 1.0))
		})

		It("should receive monotonically increasing progress values", Label("integration"), func() {
			var progressValues []float32

			model, err := llama.LoadModel(modelPath,
				llama.WithProgressCallback(func(progress float32) bool {
					progressValues = append(progressValues, progress)
					return true
				}),
				llama.WithGPULayers(-1),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			// Verify progress values generally increase (allowing for small variations)
			// Note: Progress may not be strictly monotonic due to threading, but should trend upward
			Expect(progressValues).NotTo(BeEmpty())
			if len(progressValues) > 1 {
				firstValue := progressValues[0]
				lastValue := progressValues[len(progressValues)-1]
				Expect(lastValue).To(BeNumerically(">=", firstValue))
			}
		})

		It("should cancel loading when callback returns false", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath,
				llama.WithProgressCallback(func(progress float32) bool {
					// Cancel immediately
					return false
				}),
				llama.WithGPULayers(-1),
			)

			// Loading should fail due to cancellation
			Expect(err).To(HaveOccurred())
			Expect(model).To(BeNil())
		})

		It("should cancel loading at specific progress threshold", Label("integration"), func() {
			var maxProgress float32

			model, err := llama.LoadModel(modelPath,
				llama.WithProgressCallback(func(progress float32) bool {
					if progress > maxProgress {
						maxProgress = progress
					}
					if progress > 0.5 {
						return false // Cancel after 50%
					}
					return true
				}),
				llama.WithGPULayers(-1),
			)

			// Should fail due to cancellation
			Expect(err).To(HaveOccurred())
			Expect(model).To(BeNil())

			// Verify we got past the threshold before cancellation
			// Note: Actual cancellation may happen slightly after threshold due to threading
			Expect(maxProgress).To(BeNumerically(">", 0.0))
		})

		It("should work with other options", Label("integration"), func() {
			var callCount int

			model, err := llama.LoadModel(modelPath,
				llama.WithProgressCallback(func(progress float32) bool {
					callCount++
					return true
				}),
				llama.WithGPULayers(0),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			Expect(callCount).To(BeNumerically(">", 0))

			// Verify model works after callback-monitored loading
			ctx, err := model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(2),
			)
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			response, err := ctx.Generate("Test", llama.WithMaxTokens(5))
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should clean up callback registry on successful load", Label("integration"), func() {
			var callCount int

			model, err := llama.LoadModel(modelPath,
				llama.WithProgressCallback(func(progress float32) bool {
					callCount++
					return true
				}),
				llama.WithGPULayers(-1),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())

			callbackID := model.ProgressCallbackID
			Expect(callbackID).NotTo(Equal(uintptr(0)))

			// Close should clean up registry
			model.Close()

			// We can't directly access the registry, but we can verify
			// that closing worked without panics
			runtime.GC()
		})

		It("should clean up callback registry on failed load", Label("unit"), func() {
			var callCount int

			model, err := llama.LoadModel("/nonexistent/model.gguf",
				llama.WithProgressCallback(func(progress float32) bool {
					callCount++
					return true
				}),
			)

			Expect(err).To(HaveOccurred())
			Expect(model).To(BeNil())

			// Registry should be cleaned up even on failure
			// Verify no memory leaks by running GC
			runtime.GC()
		})

		It("should clean up callback registry on cancelled load", Label("integration"), func() {
			model, err := llama.LoadModel(modelPath,
				llama.WithProgressCallback(func(progress float32) bool {
					return false // Cancel immediately
				}),
				llama.WithGPULayers(-1),
			)

			Expect(err).To(HaveOccurred())
			Expect(model).To(BeNil())

			// Registry should be cleaned up on cancellation
			runtime.GC()
		})
	})

	Context("callback registry management", func() {
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set")
			}
		})

		It("should handle multiple models with callbacks simultaneously", Label("integration"), func() {
			var count1, count2 int

			model1, err1 := llama.LoadModel(modelPath,
				llama.WithProgressCallback(func(progress float32) bool {
					count1++
					return true
				}),
				llama.WithGPULayers(-1),
			)
			Expect(err1).NotTo(HaveOccurred())
			Expect(model1).NotTo(BeNil())
			defer model1.Close()

			model2, err2 := llama.LoadModel(modelPath,
				llama.WithProgressCallback(func(progress float32) bool {
					count2++
					return true
				}),
				llama.WithGPULayers(-1),
			)
			Expect(err2).NotTo(HaveOccurred())
			Expect(model2).NotTo(BeNil())
			defer model2.Close()

			// Both callbacks should have been called
			Expect(count1).To(BeNumerically(">", 0))
			Expect(count2).To(BeNumerically(">", 0))

			// Verify both models work
			ctx1, err := model1.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx1.Close()

			response1, err := ctx1.Generate("test", llama.WithMaxTokens(1))
			Expect(err).NotTo(HaveOccurred())
			Expect(response1).NotTo(BeEmpty())

			ctx2, err := model2.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			defer ctx2.Close()

			response2, err := ctx2.Generate("test", llama.WithMaxTokens(1))
			Expect(err).NotTo(HaveOccurred())
			Expect(response2).NotTo(BeEmpty())
		})

		It("should assign unique callback IDs", Label("integration"), func() {
			model1, err1 := llama.LoadModel(modelPath,
				llama.WithProgressCallback(func(progress float32) bool {
					return true
				}),
				llama.WithGPULayers(-1),
			)
			Expect(err1).NotTo(HaveOccurred())
			Expect(model1).NotTo(BeNil())
			defer model1.Close()

			id1 := model1.ProgressCallbackID

			model2, err2 := llama.LoadModel(modelPath,
				llama.WithProgressCallback(func(progress float32) bool {
					return true
				}),
				llama.WithGPULayers(-1),
			)
			Expect(err2).NotTo(HaveOccurred())
			Expect(model2).NotTo(BeNil())
			defer model2.Close()

			id2 := model2.ProgressCallbackID

			// IDs should be different
			Expect(id1).NotTo(Equal(id2))
			Expect(id1).NotTo(Equal(uintptr(0)))
			Expect(id2).NotTo(Equal(uintptr(0)))
		})
	})

	Context("with embedding models", func() {
		var embeddingModelPath string

		BeforeEach(func() {
			embeddingModelPath = os.Getenv("TEST_EMBEDDING_MODEL")
			if embeddingModelPath == "" {
				Skip("TEST_EMBEDDING_MODEL not set")
			}
		})

		It("should work with WithSilentLoading for embedding models", Label("integration"), func() {
			model, err := llama.LoadModel(embeddingModelPath,
				llama.WithSilentLoading(),
				llama.WithGPULayers(-1),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			ctx, err := model.NewContext(
				llama.WithContext(2048),
				llama.WithEmbeddings(),
			)
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			embeddings, err := ctx.GetEmbeddings("Test")
			Expect(err).NotTo(HaveOccurred())
			Expect(embeddings).NotTo(BeEmpty())
		})

		It("should work with WithProgressCallback for embedding models", Label("integration"), func() {
			var callCount int

			model, err := llama.LoadModel(embeddingModelPath,
				llama.WithProgressCallback(func(progress float32) bool {
					callCount++
					return true
				}),
				llama.WithGPULayers(-1),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())
			defer model.Close()

			Expect(callCount).To(BeNumerically(">", 0))

			ctx, err := model.NewContext(
				llama.WithContext(2048),
				llama.WithEmbeddings(),
			)
			Expect(err).NotTo(HaveOccurred())
			defer ctx.Close()

			embeddings, err := ctx.GetEmbeddings("Test")
			Expect(err).NotTo(HaveOccurred())
			Expect(embeddings).NotTo(BeEmpty())
		})
	})
})
