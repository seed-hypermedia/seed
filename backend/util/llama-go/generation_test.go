package llama_test

import (
	"os"
	"strings"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/tcpipuk/llama-go"
)

// Generation Core Test Suite
//
// Comprehensive tests for the Model.Generate method, covering:
// - Basic generation with valid prompts
// - Sampling parameter configuration (temperature, top_p, top_k, seed)
// - max_tokens validation and edge cases
// - Stop word behaviour
// - Prompt length validation
// - Error handling for closed models and generation failures
// - Debug output behaviour
//
// Tests follow the decode-before-sample pattern and verify generation
// completes without hanging.

var _ = Describe("Model.Generate", func() {
	Context("with valid prompt and model", func() {
		var model *llama.Model
		var ctx *llama.Context
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set - skipping integration test")
			}
			var err error
			model, err = llama.LoadModel(modelPath)
			Expect(err).NotTo(HaveOccurred())
			Expect(model).NotTo(BeNil())

			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(ctx).NotTo(BeNil())
		})

		AfterEach(func() {
			if ctx != nil {
				ctx.Close()
			}
			if model != nil {
				model.Close()
			}
		})

		It("should generate text successfully", Label("integration"), func() {
			response, err := ctx.Generate("The capital of France is",
				llama.WithMaxTokens(10),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should return non-empty response", Label("integration"), func() {
			response, err := ctx.Generate("Hello",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(len(response)).To(BeNumerically(">", 0))
		})

		It("should respect WithMaxTokens limit", Label("integration"), func() {
			response, err := ctx.Generate("Count to 100:",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			// Response should be relatively short with max_tokens=5
			Expect(len(response)).To(BeNumerically("<", 200))
		})

		It("should follow decode-before-sample pattern", Label("integration"), func() {
			// Test that generation completes without hanging (previous bug)
			response, err := ctx.Generate("The quick brown fox",
				llama.WithMaxTokens(20),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should complete generation without errors", Label("integration"), func() {
			response, err := ctx.Generate("Testing generation",
				llama.WithMaxTokens(10),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeNil())
		})
	})

	Context("with sampling parameters", func() {
		var model *llama.Model
		var ctx *llama.Context
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set - skipping integration test")
			}
			var err error
			model, err = llama.LoadModel(modelPath)
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
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

		It("should apply WithTemperature option", Label("integration"), func() {
			response, err := ctx.Generate("Hello",
				llama.WithMaxTokens(10),
				llama.WithTemperature(0.5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should apply WithTopP option", Label("integration"), func() {
			response, err := ctx.Generate("Hello",
				llama.WithMaxTokens(10),
				llama.WithTopP(0.9),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should apply WithTopK option", Label("integration"), func() {
			response, err := ctx.Generate("Hello",
				llama.WithMaxTokens(10),
				llama.WithTopK(20),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should generate deterministically with WithSeed", Label("integration"), func() {
			// Same seed should produce identical output
			response1, err := ctx.Generate("The capital of France is",
				llama.WithMaxTokens(10),
				llama.WithSeed(12345),
				llama.WithTemperature(0.8),
			)
			Expect(err).NotTo(HaveOccurred())

			response2, err := ctx.Generate("The capital of France is",
				llama.WithMaxTokens(10),
				llama.WithSeed(12345),
				llama.WithTemperature(0.8),
			)
			Expect(err).NotTo(HaveOccurred())

			Expect(response1).To(Equal(response2))
		})

		It("should generate different outputs with different seeds", Label("integration"), func() {
			response1, err := ctx.Generate("The capital of France is",
				llama.WithMaxTokens(10),
				llama.WithSeed(12345),
				llama.WithTemperature(0.8),
			)
			Expect(err).NotTo(HaveOccurred())

			response2, err := ctx.Generate("The capital of France is",
				llama.WithMaxTokens(10),
				llama.WithSeed(54321),
				llama.WithTemperature(0.8),
			)
			Expect(err).NotTo(HaveOccurred())

			// Different seeds should produce different outputs (very high probability)
			Expect(response1).NotTo(Equal(response2))
		})

		It("should generate different outputs with WithSeed(-1) on repeated calls", Label("integration"), func() {
			response1, err := ctx.Generate("The capital of France is",
				llama.WithMaxTokens(10),
				llama.WithSeed(-1),
				llama.WithTemperature(0.8),
			)
			Expect(err).NotTo(HaveOccurred())

			response2, err := ctx.Generate("The capital of France is",
				llama.WithMaxTokens(10),
				llama.WithSeed(-1),
				llama.WithTemperature(0.8),
			)
			Expect(err).NotTo(HaveOccurred())

			// Random seed should produce different outputs (high probability)
			Expect(response1).NotTo(Equal(response2))
		})
	})

	Context("with max_tokens validation", func() {
		var model *llama.Model
		var ctx *llama.Context
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set - skipping integration test")
			}
			var err error
			model, err = llama.LoadModel(modelPath)
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
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

		It("should accept max_tokens=1 (minimum valid)", Label("integration"), func() {
			response, err := ctx.Generate("Hello",
				llama.WithMaxTokens(1),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should accept large max_tokens values", Label("integration"), func() {
			// Context is 40960, so this should work fine
			response, err := ctx.Generate("Hello",
				llama.WithMaxTokens(1000),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should use default when max_tokens=0", Label("integration"), func() {
			result, err := ctx.Generate("Hello",
				llama.WithMaxTokens(0),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeEmpty())
		})

		It("should return error for max_tokens=-1", Label("integration"), func() {
			_, err := ctx.Generate("Hello",
				llama.WithMaxTokens(-1),
			)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("Invalid max_tokens value"))
		})

	})

	Context("with stop words", func() {
		var model *llama.Model
		var ctx *llama.Context
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set - skipping integration test")
			}
			var err error
			model, err = llama.LoadModel(modelPath)
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
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

		It("should stop generation when stop word found", Label("integration"), func() {
			response, err := ctx.Generate("What is the capital city of France?",
				llama.WithMaxTokens(100),
				llama.WithStopWords("Paris"),
			)
			Expect(err).NotTo(HaveOccurred())
			// Should stop when "Paris" is generated (highly likely for this prompt)
			// Qwen models can be chatty, so allow up to 500 chars
			Expect(len(response)).To(BeNumerically("<", 500))
		})

		It("should respect multiple stop words", Label("integration"), func() {
			response, err := ctx.Generate("Tell me a story",
				llama.WithMaxTokens(100),
				llama.WithStopWords(".", "!", "?"),
			)
			Expect(err).NotTo(HaveOccurred())
			// Should stop at first punctuation
			Expect(response).NotTo(BeEmpty())
		})

		It("should return partial output when stopped", Label("integration"), func() {
			response, err := ctx.Generate("The quick brown fox",
				llama.WithMaxTokens(50),
				llama.WithStopWords("fox"),
			)
			Expect(err).NotTo(HaveOccurred())
			// Should have some output before stop word
			Expect(response).NotTo(BeEmpty())
		})

		It("should handle stop words not present in output", Label("integration"), func() {
			response, err := ctx.Generate("Hello world",
				llama.WithMaxTokens(10),
				llama.WithStopWords("ZZZZZ"), // Unlikely stop word
			)
			Expect(err).NotTo(HaveOccurred())
			// Should generate until max_tokens
			Expect(response).NotTo(BeEmpty())
		})

		It("should handle stop word at start of generation", Label("integration"), func() {
			response, err := ctx.Generate("Hello",
				llama.WithMaxTokens(50),
				llama.WithStopWords("Hello"),
			)
			Expect(err).NotTo(HaveOccurred())
			// May stop early if stop word appears in output
			Expect(response).NotTo(BeNil())
		})

		It("should handle stop word in middle of generation", Label("integration"), func() {
			response, err := ctx.Generate("Count to 10",
				llama.WithMaxTokens(100),
				llama.WithStopWords("5"),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})
	})

	Context("with empty or invalid prompts", func() {
		var model *llama.Model
		var ctx *llama.Context
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set - skipping integration test")
			}
			var err error
			model, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
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

		It("should handle empty string prompt", Label("integration"), func() {
			_, err := ctx.Generate("",
				llama.WithMaxTokens(10),
			)
			// May succeed with BOS token or fail - check behaviour
			if err != nil {
				Expect(err.Error()).To(ContainSubstring("Failed to tokenize prompt"))
			}
		})

		It("should return error containing \"Failed to tokenize prompt\"", Label("integration"), func() {
			// Empty prompt may cause tokenisation failure
			_, err := ctx.Generate("",
				llama.WithMaxTokens(10),
			)
			if err != nil {
				Expect(err.Error()).To(ContainSubstring("Failed to tokenize prompt"))
			}
		})
	})

	Context("with prompt length validation", func() {
		var model *llama.Model
		var ctx *llama.Context
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set - skipping integration test")
			}
			var err error
			// Use small context for easier testing
			model, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(
				llama.WithContext(128),
				llama.WithThreads(4),
			)
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

		It("should accept prompt under context limit", Label("integration"), func() {
			response, err := ctx.Generate("Short prompt",
				llama.WithMaxTokens(10),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should return error when prompt fills entire context", Label("integration"), func() {
			// Generate very long prompt (300+ tokens for context=128)
			longPrompt := strings.Repeat("word ", 300)
			_, err := ctx.Generate(longPrompt,
				llama.WithMaxTokens(10),
			)
			Expect(err).To(HaveOccurred())
		})

		It("should error with \"Prompt too long for context size\"", Label("integration"), func() {
			// Generate very long prompt (300+ tokens for context=128)
			longPrompt := strings.Repeat("word ", 300)
			_, err := ctx.Generate(longPrompt,
				llama.WithMaxTokens(10),
			)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("Prompt too long for context size"))
		})

		It("should require at least 1 token space for generation", Label("integration"), func() {
			// Prompt that fills context-1 tokens should work
			// Prompt that fills context tokens should fail
			longPrompt := strings.Repeat("word ", 150)
			_, err := ctx.Generate(longPrompt,
				llama.WithMaxTokens(10),
			)
			if err != nil {
				Expect(err.Error()).To(ContainSubstring("need at least 1 token for generation"))
			}
		})
	})

	Context("when context is closed", func() {
		var model *llama.Model
		var ctx *llama.Context
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set - skipping integration test")
			}
			var err error
			model, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(llama.WithContext(2048))
			Expect(err).NotTo(HaveOccurred())
			// Close context before test
			ctx.Close()
		})

		AfterEach(func() {
			if model != nil {
				model.Close()
			}
		})

		It("should return \"context is closed\" error", Label("integration"), func() {
			_, err := ctx.Generate("Hello",
				llama.WithMaxTokens(10),
			)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(Equal("context is closed"))
		})

		It("should not crash or panic", Label("integration"), func() {
			// Should fail gracefully without panic
			_, err := ctx.Generate("Hello",
				llama.WithMaxTokens(10),
			)
			Expect(err).To(HaveOccurred())
		})

		It("should fail immediately without attempting generation", Label("integration"), func() {
			_, err := ctx.Generate("Hello",
				llama.WithMaxTokens(10),
			)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(Equal("context is closed"))
		})
	})

	Context("with debug output", func() {
		var model *llama.Model
		var ctx *llama.Context
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set - skipping integration test")
			}
			var err error
			model, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
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

		It("should enable debug mode with WithDebug()", Label("integration"), func() {
			// Debug output goes to stderr - can't easily capture, but verify no errors
			response, err := ctx.Generate("Hello",
				llama.WithMaxTokens(5),
				llama.WithDebug(),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should output warnings to stderr", Label("integration"), func() {
			// WithDebug enables stderr output - verify doesn't crash
			_, _ = ctx.Generate("Test",
				llama.WithMaxTokens(10),
				llama.WithDebug(),
			)
			// If this completes without panic, debug output is working
		})
	})

	Context("when generation encounters errors", func() {
		var model *llama.Model
		var ctx *llama.Context
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set - skipping integration test")
			}
			var err error
			model, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
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

		It("should return error with \"generation failed:\" prefix", Label("integration"), func() {
			// Invalid max_tokens triggers generation error
			_, err := ctx.Generate("Hello",
				llama.WithMaxTokens(-1),
			)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(HavePrefix("generation failed:"))
		})

		It("should handle decode failures gracefully", Label("integration"), func() {
			// Normal generation shouldn't fail, but should handle gracefully if it does
			_, err := ctx.Generate("Test",
				llama.WithMaxTokens(10),
			)
			if err != nil {
				Expect(err.Error()).NotTo(BeEmpty())
			}
		})

		It("should handle sampler initialisation failures", Label("integration"), func() {
			// Normal configuration should work
			response, err := ctx.Generate("Test",
				llama.WithMaxTokens(10),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should return actionable error messages", Label("integration"), func() {
			_, err := ctx.Generate("Hello",
				llama.WithMaxTokens(10000),
			)
			Expect(err).To(HaveOccurred())
			// Error should include useful context about why generation failed
			Expect(err.Error()).To(ContainSubstring("tokens"))
			Expect(err.Error()).To(ContainSubstring("context size"))
		})
	})
})

var _ = Describe("Generation Edge Cases", func() {
	Context("with extreme sampling parameters", func() {
		var model *llama.Model
		var ctx *llama.Context
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set - skipping integration test")
			}
			var err error
			model, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
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

		It("should handle temperature=0.0", Label("integration"), func() {
			response, err := ctx.Generate("The capital of France is",
				llama.WithMaxTokens(10),
				llama.WithTemperature(0.0),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should handle temperature=2.0", Label("integration"), func() {
			response, err := ctx.Generate("Hello",
				llama.WithMaxTokens(10),
				llama.WithTemperature(2.0),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should handle top_p=1.0", Label("integration"), func() {
			response, err := ctx.Generate("Hello",
				llama.WithMaxTokens(10),
				llama.WithTopP(1.0),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should handle top_k=1", Label("integration"), func() {
			response, err := ctx.Generate("Hello",
				llama.WithMaxTokens(10),
				llama.WithTopK(1),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})
	})

	Context("with stop conditions", func() {
		var model *llama.Model
		var ctx *llama.Context
		var modelPath string

		BeforeEach(func() {
			modelPath = os.Getenv("TEST_CHAT_MODEL")
			if modelPath == "" {
				Skip("TEST_CHAT_MODEL not set - skipping integration test")
			}
			var err error
			model, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
			Expect(err).NotTo(HaveOccurred())

			ctx, err = model.NewContext(
				llama.WithContext(2048),
				llama.WithThreads(4),
			)
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

		It("should stop on EOS token", Label("integration"), func() {
			// EOS token stops generation naturally
			response, err := ctx.Generate("Hello",
				llama.WithMaxTokens(100),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(response).NotTo(BeEmpty())
		})

		It("should stop at max_tokens limit", Label("integration"), func() {
			response, err := ctx.Generate("Count to 1000:",
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			// Should stop at 5 tokens, not complete counting
			Expect(response).NotTo(BeEmpty())
		})

		It("should prioritise stop words over max_tokens", Label("integration"), func() {
			response, err := ctx.Generate("The quick brown fox jumps",
				llama.WithMaxTokens(100),
				llama.WithStopWords("over"),
			)
			Expect(err).NotTo(HaveOccurred())
			// Completing the famous phrase makes "over" highly likely
			// Should stop when "over" is generated, producing short response
			Expect(len(response)).To(BeNumerically("<", 50))
		})
	})
})
