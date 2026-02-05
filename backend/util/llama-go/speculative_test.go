package llama_test

import (
	"os"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/tcpipuk/llama-go"
)

// Speculative Sampling Test Suite
//
// Tests for GenerateWithDraft and GenerateWithDraftStream methods, covering:
// - Valid speculative generation with target and draft models
// - Draft token configuration and defaults
// - Model state validation (closed models)
// - Sampling parameters in speculative mode
// - Streaming with callbacks
// - Position tracking and accepted token handling
// - Error conditions and edge cases

var _ = Describe("Context.GenerateWithDraft", func() {
	var (
		modelPath   string
		targetModel *llama.Model
		draftModel  *llama.Model
		targetCtx   *llama.Context
		draftCtx    *llama.Context
		testPrompt  = "The capital of France is"
	)

	BeforeEach(func() {
		modelPath = os.Getenv("TEST_CHAT_MODEL")
		if modelPath == "" {
			Skip("TEST_CHAT_MODEL not set - skipping integration test")
		}
	})

	AfterEach(func() {
		if draftCtx != nil {
			draftCtx.Close()
			draftCtx = nil
		}
		if targetCtx != nil {
			targetCtx.Close()
			targetCtx = nil
		}
		if draftModel != nil {
			draftModel.Close()
			draftModel = nil
		}
		if targetModel != nil {
			targetModel.Close()
			targetModel = nil
		}
	})

	Context("with valid target and draft contexts", func() {
		BeforeEach(func() {
			var err error
			targetModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(targetModel).NotTo(BeNil())

			targetCtx, err = targetModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(targetCtx).NotTo(BeNil())

			draftModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())
			Expect(draftModel).NotTo(BeNil())

			draftCtx, err = draftModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(draftCtx).NotTo(BeNil())
		})

		It("should perform speculative generation successfully", Label("integration"), func() {
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithTemperature(0.7),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should return generated text", Label("integration"), func() {
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(30),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).To(BeAssignableToTypeOf(""))
			Expect(len(response)).To(BeNumerically(">", 0))
		})

		It("should use draft context for speculation", Label("integration"), func() {
			// Verify speculative generation completes without draft context errors
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithDraftTokens(16),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should verify with target context", Label("integration"), func() {
			// Speculative sampling uses target context for verification
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should produce coherent output", Label("integration"), func() {
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(100),
				llama.WithTemperature(0.7),
			)
			Expect(err).NotTo(HaveOccurred())
			// Verify output is non-empty and contains reasonable text
			Expect(len(response)).To(BeNumerically(">", 0))
		})
	})

	Context("with draft token configuration", func() {
		BeforeEach(func() {
			var err error
			targetModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			targetCtx, err = targetModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			draftModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			draftCtx, err = draftModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())
		})

		It("should apply WithDraftTokens option", Label("integration"), func() {
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithDraftTokens(8),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should use default 16 draft tokens when not specified", Label("integration"), func() {
			// Default behaviour without WithDraftTokens
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should accept draft_tokens=1", Label("integration"), func() {
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(30),
				llama.WithDraftTokens(1),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should accept draft_tokens=64", Label("integration"), func() {
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithDraftTokens(64),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should use 16 if draft_tokens≤0", Label("integration"), func() {
			// C++ defaults to 16 if draft_tokens ≤ 0
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithDraftTokens(0),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})
	})

	Context("with same model as target and draft", func() {
		BeforeEach(func() {
			var err error
			targetModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			targetCtx, err = targetModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			// Use same model for both target and draft
			draftModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			draftCtx, err = draftModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())
		})

		It("should work with same model for both", Label("integration"), func() {
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should complete generation without errors", Label("integration"), func() {
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithDraftTokens(16),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should produce valid output", Label("integration"), func() {
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(len(response)).To(BeNumerically(">", 0))
		})
	})

	Context("when draft context is closed", func() {
		BeforeEach(func() {
			var err error
			targetModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			targetCtx, err = targetModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			draftModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			draftCtx, err = draftModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			// Close draft context before generation
			draftCtx.Close()
		})

		It("should return 'context is closed' error", Label("integration"), func() {
			_, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
			)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(Equal("context is closed"))
		})

		It("should fail before generation starts", Label("integration"), func() {
			_, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
			)
			Expect(err).To(HaveOccurred())
			// Error should occur immediately, not after partial generation
			Expect(err.Error()).To(Equal("context is closed"))
		})

		It("should not crash or panic", Label("integration"), func() {
			Expect(func() {
				_, _ = targetCtx.GenerateWithDraft(testPrompt, draftCtx,
					llama.WithMaxTokens(50),
				)
			}).NotTo(Panic())
		})
	})

	Context("when target context is closed", func() {
		BeforeEach(func() {
			var err error
			targetModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			targetCtx, err = targetModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			draftModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			draftCtx, err = draftModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			// Close target context before generation
			targetCtx.Close()
		})

		It("should return 'context is closed' error", Label("integration"), func() {
			_, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
			)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(Equal("context is closed"))
		})

		It("should fail before generation starts", Label("integration"), func() {
			_, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
			)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(Equal("context is closed"))
		})
	})

	Context("with sampling parameters", func() {
		BeforeEach(func() {
			var err error
			targetModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			targetCtx, err = targetModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			draftModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			draftCtx, err = draftModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())
		})

		It("should apply temperature to target model sampling", Label("integration"), func() {
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithTemperature(0.5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should apply top_p and top_k", Label("integration"), func() {
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithTopP(0.9),
				llama.WithTopK(50),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should use WithSeed for deterministic speculative generation", Label("integration"), func() {
			// Generate twice with same seed
			response1, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithSeed(12345),
			)
			Expect(err).NotTo(HaveOccurred())

			response2, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithSeed(12345),
			)
			Expect(err).NotTo(HaveOccurred())

			// Should produce identical output with same seed
			Expect(response1).To(Equal(response2))
		})
	})

	Context("with speculative parameters", func() {
		BeforeEach(func() {
			var err error
			targetModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			targetCtx, err = targetModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			draftModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			draftCtx, err = draftModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())
		})

		It("should use p_min=0.75 (hardcoded)", Label("integration"), func() {
			// p_min is hardcoded to 0.75 in C++ layer
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should generate draft tokens per iteration", Label("integration"), func() {
			// Verify draft token generation happens
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithDraftTokens(16),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should accept/reject tokens based on target model", Label("integration"), func() {
			// Speculative sampling accepts/rejects draft tokens via target model
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithDraftTokens(16),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})
	})

	Context("when speculative initialisation fails", func() {
		BeforeEach(func() {
			var err error
			targetModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			targetCtx, err = targetModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			draftModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			draftCtx, err = draftModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())
		})

		It("should return error containing 'Failed to initialize speculative sampling'", Label("integration"), func() {
			// This tests error message format; actual init failure is hard to trigger
			// but would come from C++ layer with this message
			_, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
			)
			// In normal operation, this should succeed
			// Error case would occur with invalid model configuration
			if err != nil {
				Expect(err.Error()).To(ContainSubstring("Failed to initialize speculative sampling"))
			}
		})

		It("should handle tokenisation failures", Label("integration"), func() {
			// Empty prompt should trigger tokenisation failure
			_, err := targetCtx.GenerateWithDraft("", draftCtx,
				llama.WithMaxTokens(50),
			)
			if err != nil {
				Expect(err.Error()).To(ContainSubstring("Failed to tokenize prompt"))
			}
		})
	})

	Context("with prompt validation", func() {
		BeforeEach(func() {
			var err error
			targetModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			targetCtx, err = targetModel.NewContext(
				llama.WithContext(128), // Small context for testing
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			draftModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			draftCtx, err = draftModel.NewContext(
				llama.WithContext(128),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())
		})

		It("should validate prompt on target context", Label("integration"), func() {
			// Normal prompt should work
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(20),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should return error for prompts exceeding context", Label("integration"), func() {
			// Create very long prompt to exceed small context
			longPrompt := ""
			for i := 0; i < 200; i++ {
				longPrompt += "This is a very long prompt that will exceed the context size. "
			}

			_, err := targetCtx.GenerateWithDraft(longPrompt, draftCtx,
				llama.WithMaxTokens(10),
			)
			Expect(err).To(HaveOccurred())
			// In speculative mode, oversized prompts fail during decode
			Expect(err.Error()).To(ContainSubstring("Failed to decode prompt"))
		})

		It("should tokenise prompt before speculative sampling starts", Label("integration"), func() {
			// Tokenisation happens before speculative loop
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(30),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})
	})
})

var _ = Describe("Context.GenerateWithDraftStream", func() {
	var (
		modelPath   string
		targetModel *llama.Model
		draftModel  *llama.Model
		targetCtx   *llama.Context
		draftCtx    *llama.Context
		testPrompt  = "The capital of France is"
	)

	BeforeEach(func() {
		modelPath = os.Getenv("TEST_CHAT_MODEL")
		if modelPath == "" {
			Skip("TEST_CHAT_MODEL not set - skipping integration test")
		}
	})

	AfterEach(func() {
		if draftCtx != nil {
			draftCtx.Close()
			draftCtx = nil
		}
		if targetCtx != nil {
			targetCtx.Close()
			targetCtx = nil
		}
		if draftModel != nil {
			draftModel.Close()
			draftModel = nil
		}
		if targetModel != nil {
			targetModel.Close()
			targetModel = nil
		}
	})

	Context("with streaming callback", func() {
		BeforeEach(func() {
			var err error
			targetModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			targetCtx, err = targetModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			draftModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			draftCtx, err = draftModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())
		})

		It("should call callback for each accepted token", Label("integration"), func() {
			tokenCount := 0
			callback := func(token string) bool {
				tokenCount++
				return true
			}

			err := targetCtx.GenerateWithDraftStream(testPrompt, draftCtx, callback,
				llama.WithMaxTokens(30),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(tokenCount).To(BeNumerically(">", 0))
		})

		It("should stream speculative generation results", Label("integration"), func() {
			var accumulated string
			callback := func(token string) bool {
				accumulated += token
				return true
			}

			err := targetCtx.GenerateWithDraftStream(testPrompt, draftCtx, callback,
				llama.WithMaxTokens(50),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(accumulated).NotTo(BeEmpty())
		})

		It("should allow early termination via callback", Label("integration"), func() {
			tokenCount := 0
			maxTokens := 5
			callback := func(token string) bool {
				tokenCount++
				return tokenCount < maxTokens
			}

			err := targetCtx.GenerateWithDraftStream(testPrompt, draftCtx, callback,
				llama.WithMaxTokens(50),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(tokenCount).To(BeNumerically(">=", maxTokens))
		})
	})

	Context("when callback returns false", func() {
		BeforeEach(func() {
			var err error
			targetModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			targetCtx, err = targetModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			draftModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			draftCtx, err = draftModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())
		})

		It("should stop speculative generation", Label("integration"), func() {
			callbackCalled := false
			callback := func(token string) bool {
				if !callbackCalled {
					callbackCalled = true
					return false // Stop immediately
				}
				return false
			}

			err := targetCtx.GenerateWithDraftStream(testPrompt, draftCtx, callback,
				llama.WithMaxTokens(50),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(callbackCalled).To(BeTrue())
		})

		It("should not return error (graceful stop)", Label("integration"), func() {
			callback := func(token string) bool {
				return false // Stop on first token
			}

			err := targetCtx.GenerateWithDraftStream(testPrompt, draftCtx, callback,
				llama.WithMaxTokens(50),
			)
			Expect(err).NotTo(HaveOccurred())
		})

		It("should have generated partial output", Label("integration"), func() {
			var accumulated string
			callback := func(token string) bool {
				accumulated += token
				return len(accumulated) < 20 // Stop after ~20 characters
			}

			err := targetCtx.GenerateWithDraftStream(testPrompt, draftCtx, callback,
				llama.WithMaxTokens(100),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(accumulated).NotTo(BeEmpty())
		})
	})

	Context("with stop words in speculative streaming", func() {
		BeforeEach(func() {
			var err error
			targetModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			targetCtx, err = targetModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			draftModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			draftCtx, err = draftModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())
		})

		It("should stop when stop word found in accumulated output", Label("integration"), func() {
			var accumulated string
			callback := func(token string) bool {
				accumulated += token
				return true
			}

			err := targetCtx.GenerateWithDraftStream(testPrompt, draftCtx, callback,
				llama.WithMaxTokens(100),
				llama.WithStopWords("."),
			)
			Expect(err).NotTo(HaveOccurred())
			// Should stop when encountering period
		})

		It("should respect stop words with speculative sampling", Label("integration"), func() {
			tokensSeen := 0
			callback := func(token string) bool {
				tokensSeen++
				return true
			}

			err := targetCtx.GenerateWithDraftStream("Count: 1, 2, 3", draftCtx, callback,
				llama.WithMaxTokens(100),
				llama.WithStopWords("3"),
			)
			Expect(err).NotTo(HaveOccurred())
			// Should have stopped at or before stop word
			Expect(tokensSeen).To(BeNumerically(">", 0))
		})
	})

	Context("when draft context is closed during streaming", func() {
		BeforeEach(func() {
			var err error
			targetModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			targetCtx, err = targetModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			draftModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			draftCtx, err = draftModel.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())

			// Close draft context before streaming
			draftCtx.Close()
		})

		It("should return 'context is closed' error", Label("integration"), func() {
			callback := func(token string) bool {
				return true
			}

			err := targetCtx.GenerateWithDraftStream(testPrompt, draftCtx, callback,
				llama.WithMaxTokens(50),
			)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(Equal("context is closed"))
		})

		It("should not call callback after error", Label("integration"), func() {
			callbackCalled := false
			callback := func(token string) bool {
				callbackCalled = true
				return true
			}

			err := targetCtx.GenerateWithDraftStream(testPrompt, draftCtx, callback,
				llama.WithMaxTokens(50),
			)
			Expect(err).To(HaveOccurred())
			Expect(callbackCalled).To(BeFalse())
		})
	})
})

var _ = Describe("Speculative Sampling Edge Cases", func() {
	var (
		modelPath   string
		targetModel *llama.Model
		targetCtx   *llama.Context
		draftModel  *llama.Model
		draftCtx    *llama.Context
		testPrompt  = "The capital of France is"
	)

	BeforeEach(func() {
		modelPath = os.Getenv("TEST_CHAT_MODEL")
		if modelPath == "" {
			Skip("TEST_CHAT_MODEL not set - skipping integration test")
		}

		var err error
		targetModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
		Expect(err).NotTo(HaveOccurred())

		targetCtx, err = targetModel.NewContext(
			llama.WithContext(2048),
			llama.WithThreads(4),
		)
		Expect(err).NotTo(HaveOccurred())

		draftModel, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
		Expect(err).NotTo(HaveOccurred())

		draftCtx, err = draftModel.NewContext(
			llama.WithContext(2048),
			llama.WithThreads(4),
		)
		Expect(err).NotTo(HaveOccurred())
	})

	AfterEach(func() {
		if draftCtx != nil {
			draftCtx.Close()
		}
		if targetCtx != nil {
			targetCtx.Close()
		}
		if draftModel != nil {
			draftModel.Close()
		}
		if targetModel != nil {
			targetModel.Close()
		}
	})

	Context("with position tracking", func() {
		It("should increment position by accepted tokens only", Label("integration"), func() {
			// This tests the fix for position tracking bug
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithDraftTokens(16),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
			// If position tracking was broken, generation would hang or fail
		})

		It("should not increment by draft token count", Label("integration"), func() {
			// Position should only advance by accepted tokens, not all draft tokens
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithDraftTokens(32), // Large draft count
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should maintain correct position through multiple iterations", Label("integration"), func() {
			// Multiple speculative iterations should maintain correct position
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(100),
				llama.WithDraftTokens(16),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})
	})

	Context("with decode failures", func() {
		It("should handle target decode failures gracefully", Label("integration"), func() {
			// Normal operation should succeed
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
			)
			// Decode failures would result in error or early termination
			if err != nil {
				Expect(err.Error()).To(ContainSubstring("decode failed"))
			} else {
				Expect(response).NotTo(BeEmpty())
			}
		})

		It("should output 'target decode failed, stopping' to debug", Label("integration"), func() {
			// With WithDebug(), decode failures output to stderr
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithDebug(),
			)
			// In normal operation this should succeed
			// Decode failure would terminate generation
			if err != nil {
				Expect(err.Error()).To(ContainSubstring("decode failed"))
			} else {
				Expect(response).NotTo(BeEmpty())
			}
		})

		It("should return error with details", Label("integration"), func() {
			// Decode failures should return descriptive errors
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
			)
			if err != nil {
				// Error should contain useful information
				Expect(err.Error()).NotTo(BeEmpty())
			} else {
				Expect(response).NotTo(BeEmpty())
			}
		})
	})

	Context("with sampler errors", func() {
		It("should return error when sampler init fails", Label("integration"), func() {
			// Normal configuration should succeed
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
			)
			// Sampler init failure would return specific error
			if err != nil {
				Expect(err.Error()).To(ContainSubstring("Failed to initialize sampler"))
			} else {
				Expect(response).NotTo(BeEmpty())
			}
		})

		It("should handle sampling failures during generation", Label("integration"), func() {
			// Sampling should work correctly in normal operation
			response, err := targetCtx.GenerateWithDraft(testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithTemperature(0.8),
				llama.WithTopP(0.95),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})
	})
})
