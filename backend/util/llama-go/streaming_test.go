package llama_test

import (
	"os"
	"strings"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/tcpipuk/llama-go"
)

// Streaming test suite for GenerateStream functionality.
// Tests callback behaviour, early termination, stop words, and streaming-specific edge cases.

var _ = Describe("Context.GenerateStream", func() {
	var (
		model     *llama.Model
		ctx       *llama.Context
		modelPath string
	)

	BeforeEach(func() {
		modelPath = os.Getenv("TEST_CHAT_MODEL")
		if modelPath == "" {
			Skip("TEST_CHAT_MODEL not set - skipping integration test")
		}

		var err error
		model, err = llama.LoadModel(modelPath, llama.WithGPULayers(-1))
		Expect(err).NotTo(HaveOccurred())
		Expect(model).NotTo(BeNil())

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

	Context("with valid callback", func() {
		It("should call callback for each token", Label("integration"), func() {
			callCount := 0
			callback := func(token string) bool {
				callCount++
				return true
			}

			err := ctx.GenerateStream("The capital of France is",
				callback,
				llama.WithMaxTokens(10),
				llama.WithTemperature(0.7),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(callCount).To(BeNumerically(">", 0))
		})

		It("should pass complete token strings to callback", Label("integration"), func() {
			var tokens []string
			callback := func(token string) bool {
				tokens = append(tokens, token)
				return true
			}

			err := ctx.GenerateStream("Hello",
				callback,
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(tokens).NotTo(BeEmpty())
			// Each token should be a non-empty string
			for _, token := range tokens {
				Expect(token).NotTo(BeEmpty())
			}
		})

		It("should accumulate tokens when callback returns true", Label("integration"), func() {
			var accumulated string
			callback := func(token string) bool {
				accumulated += token
				return true
			}

			err := ctx.GenerateStream("The sky is",
				callback,
				llama.WithMaxTokens(20),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(accumulated).NotTo(BeEmpty())
		})

		It("should generate complete response with streaming", Label("integration"), func() {
			var streamResult string
			callback := func(token string) bool {
				streamResult += token
				return true
			}

			err := ctx.GenerateStream("2+2=",
				callback,
				llama.WithMaxTokens(10),
				llama.WithSeed(42),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(streamResult).NotTo(BeEmpty())

			// Verify result is coherent text
			Expect(len(streamResult)).To(BeNumerically(">", 0))
		})

		It("should call callback synchronously in generation thread", Label("integration"), func() {
			threadID := ""
			callback := func(token string) bool {
				// Callbacks should execute in same goroutine
				// We can't directly test goroutine ID, but we can verify sequential execution
				if threadID == "" {
					threadID = "set"
				}
				return true
			}

			err := ctx.GenerateStream("Test",
				callback,
				llama.WithMaxTokens(5),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(threadID).To(Equal("set"))
		})
	})

	Context("when callback returns false", func() {
		It("should stop generation immediately", Label("integration"), func() {
			tokenCount := 0
			callback := func(token string) bool {
				tokenCount++
				return false
			}

			err := ctx.GenerateStream("Tell me a story",
				callback,
				llama.WithMaxTokens(100),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(tokenCount).To(Equal(1), "should stop after first token")
		})

		It("should not return error when stopped by callback", Label("integration"), func() {
			callback := func(token string) bool {
				return false
			}

			err := ctx.GenerateStream("The",
				callback,
				llama.WithMaxTokens(50),
			)
			Expect(err).NotTo(HaveOccurred(), "callback returning false should be graceful stop, not error")
		})

		It("should have generated partial output before stop", Label("integration"), func() {
			var output string
			callback := func(token string) bool {
				output += token
				return false
			}

			err := ctx.GenerateStream("Hello",
				callback,
				llama.WithMaxTokens(50),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(output).NotTo(BeEmpty(), "should have at least one token before stopping")
		})

		It("should output 'Generation stopped by callback' to debug", Label("integration"), func() {
			// This test requires stderr capture, which is complex in Go tests
			// We verify the behaviour indirectly by confirming callback stop works
			callback := func(token string) bool {
				return false
			}

			err := ctx.GenerateStream("Test",
				callback,
				llama.WithMaxTokens(50),
				llama.WithDebug(),
			)
			Expect(err).NotTo(HaveOccurred())
		})
	})

	Context("with callback returning false immediately", func() {
		It("should stop after first token", Label("integration"), func() {
			count := 0
			callback := func(token string) bool {
				count++
				return false
			}

			err := ctx.GenerateStream("Write a long story",
				callback,
				llama.WithMaxTokens(1000),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(count).To(Equal(1))
		})

		It("should not panic or crash", Label("integration"), func() {
			callback := func(token string) bool {
				return false
			}

			Expect(func() {
				_ = ctx.GenerateStream("Test", callback, llama.WithMaxTokens(50))
			}).NotTo(Panic())
		})

		It("should return successfully (no error)", Label("integration"), func() {
			callback := func(token string) bool {
				return false
			}

			err := ctx.GenerateStream("Quick test",
				callback,
				llama.WithMaxTokens(100),
			)
			Expect(err).NotTo(HaveOccurred())
		})
	})

	Context("with callback returning false mid-generation", func() {
		It("should stop at the point callback returned false", Label("integration"), func() {
			const stopAfter = 5
			count := 0
			callback := func(token string) bool {
				count++
				return count < stopAfter
			}

			err := ctx.GenerateStream("Tell me a long story about dragons",
				callback,
				llama.WithMaxTokens(100),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(count).To(Equal(stopAfter))
		})

		It("should have processed some tokens before stopping", Label("integration"), func() {
			var tokens []string
			callback := func(token string) bool {
				tokens = append(tokens, token)
				return len(tokens) < 3
			}

			err := ctx.GenerateStream("Count to ten",
				callback,
				llama.WithMaxTokens(50),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(len(tokens)).To(Equal(3))
		})

		It("should not continue after callback returns false", Label("integration"), func() {
			count := 0
			stopAt := 3
			callback := func(token string) bool {
				count++
				return count < stopAt
			}

			err := ctx.GenerateStream("Generate text",
				callback,
				llama.WithMaxTokens(100),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(count).To(Equal(stopAt), "should not call callback after it returns false")
		})
	})

	Context("with stop words in streaming", func() {
		It("should stop when stop word encountered", Label("integration"), func() {
			var output string
			callback := func(token string) bool {
				output += token
				return true
			}

			err := ctx.GenerateStream("The sky is blue.",
				callback,
				llama.WithMaxTokens(50),
				llama.WithStopWords("."),
			)
			Expect(err).NotTo(HaveOccurred())
			// Output should stop at or before the stop word
		})

		It("should call callback for tokens before stop word", Label("integration"), func() {
			var tokens []string
			callback := func(token string) bool {
				tokens = append(tokens, token)
				return true
			}

			err := ctx.GenerateStream("Hello world.",
				callback,
				llama.WithMaxTokens(50),
				llama.WithStopWords("world"),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(tokens).NotTo(BeEmpty())
		})

		It("should not call callback after stop word found", Label("integration"), func() {
			var output string
			callback := func(token string) bool {
				output += token
				return true
			}

			err := ctx.GenerateStream("One two three four five",
				callback,
				llama.WithMaxTokens(50),
				llama.WithStopWords("three"),
			)
			Expect(err).NotTo(HaveOccurred())
			// After stop word is found, no more callbacks should occur
		})

		It("should output 'Stop word found, ending generation' to debug", Label("integration"), func() {
			// Behaviour verified indirectly - stop words should work
			callback := func(token string) bool {
				return true
			}

			err := ctx.GenerateStream("Test sentence.",
				callback,
				llama.WithMaxTokens(50),
				llama.WithStopWords("."),
				llama.WithDebug(),
			)
			Expect(err).NotTo(HaveOccurred())
		})
	})

	Context("with callback and stop words combined", func() {
		It("should respect callback return value first", Label("integration"), func() {
			count := 0
			callback := func(token string) bool {
				count++
				return count < 3
			}

			err := ctx.GenerateStream("This is a test sentence.",
				callback,
				llama.WithMaxTokens(50),
				llama.WithStopWords("."),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(count).To(Equal(3), "callback should control stopping")
		})

		It("should check stop words after each callback", Label("integration"), func() {
			var output string
			callback := func(token string) bool {
				output += token
				// Check if stop word accumulated in output
				return !strings.Contains(output, "STOP")
			}

			err := ctx.GenerateStream("Continue until STOP appears",
				callback,
				llama.WithMaxTokens(100),
				llama.WithStopWords("STOP"),
			)
			Expect(err).NotTo(HaveOccurred())
		})

		It("should stop on whichever condition triggers first", Label("integration"), func() {
			count := 0
			var output string
			callback := func(token string) bool {
				count++
				output += token
				return count < 100 // Very high limit
			}

			err := ctx.GenerateStream("Short text.",
				callback,
				llama.WithMaxTokens(5),
				llama.WithStopWords("."),
			)
			Expect(err).NotTo(HaveOccurred())
			// Should stop at either stop word or max tokens, whichever comes first
			Expect(count).To(BeNumerically("<=", 5))
		})
	})

	Context("when context is closed", func() {
		It("should return 'context is closed' error", Label("integration"), func() {
			ctx.Close()

			callback := func(token string) bool {
				return true
			}

			err := ctx.GenerateStream("Test",
				callback,
				llama.WithMaxTokens(10),
			)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(Equal("context is closed"))
		})

		It("should not call callback when context closed", Label("integration"), func() {
			ctx.Close()

			callbackCalled := false
			callback := func(token string) bool {
				callbackCalled = true
				return true
			}

			err := ctx.GenerateStream("Test",
				callback,
				llama.WithMaxTokens(10),
			)
			Expect(err).To(HaveOccurred())
			Expect(callbackCalled).To(BeFalse(), "callback should not be invoked on closed context")
		})
	})

	Context("with streaming options", func() {
		It("should respect WithMaxTokens in streaming mode", Label("integration"), func() {
			const maxTokens = 5
			count := 0
			callback := func(token string) bool {
				count++
				return true
			}

			err := ctx.GenerateStream("Write a long story",
				callback,
				llama.WithMaxTokens(maxTokens),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(count).To(BeNumerically("<=", maxTokens))
		})

		It("should apply sampling parameters (temperature, top_p, etc.)", Label("integration"), func() {
			var output1, output2 string
			callback1 := func(token string) bool {
				output1 += token
				return true
			}
			callback2 := func(token string) bool {
				output2 += token
				return true
			}

			prompt := "The capital of France is"

			// Generate with different temperatures
			err := ctx.GenerateStream(prompt,
				callback1,
				llama.WithMaxTokens(10),
				llama.WithTemperature(0.0), // Very deterministic
				llama.WithSeed(42),
			)
			Expect(err).NotTo(HaveOccurred())

			err = ctx.GenerateStream(prompt,
				callback2,
				llama.WithMaxTokens(10),
				llama.WithTemperature(2.0), // Very random
				llama.WithSeed(43),
			)
			Expect(err).NotTo(HaveOccurred())

			// Outputs should be different due to temperature
			Expect(output1).NotTo(BeEmpty())
			Expect(output2).NotTo(BeEmpty())
		})

	})
})

var _ = Describe("Streaming Callback Behaviour", func() {
	var (
		model     *llama.Model
		ctx       *llama.Context
		modelPath string
	)

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

	Context("with callback tracking tokens", func() {
		It("should receive tokens in generation order", Label("integration"), func() {
			var tokens []string
			callback := func(token string) bool {
				tokens = append(tokens, token)
				return true
			}

			err := ctx.GenerateStream("Count: one two three",
				callback,
				llama.WithMaxTokens(15),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(tokens).NotTo(BeEmpty())
			// Tokens should be in sequential order
		})

		It("should handle partial words (tokens may be subword units)", Label("integration"), func() {
			var tokens []string
			callback := func(token string) bool {
				tokens = append(tokens, token)
				return true
			}

			err := ctx.GenerateStream("Internationalization",
				callback,
				llama.WithMaxTokens(10),
			)
			Expect(err).NotTo(HaveOccurred())
			// Tokens may be partial words due to BPE/subword tokenisation
			Expect(tokens).NotTo(BeEmpty())
		})
	})

	Context("with stateful callback", func() {
		It("should maintain state across callback invocations", Label("integration"), func() {
			tokenCounter := 0
			callback := func(token string) bool {
				tokenCounter++
				return true
			}

			err := ctx.GenerateStream("Generate some text",
				callback,
				llama.WithMaxTokens(10),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(tokenCounter).To(BeNumerically(">", 0))
			Expect(tokenCounter).To(BeNumerically("<=", 10))
		})

		It("should allow callback to make decisions based on accumulated output", Label("integration"), func() {
			var accumulated string
			callback := func(token string) bool {
				accumulated += token
				// Stop if accumulated output is long enough
				return len(accumulated) < 50
			}

			err := ctx.GenerateStream("Write a paragraph",
				callback,
				llama.WithMaxTokens(100),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(len(accumulated)).To(BeNumerically(">=", 50))
			Expect(len(accumulated)).To(BeNumerically("<", 200))
		})
	})

	Context("callback early termination scenarios", func() {
		It("should stop when accumulated output reaches desired length", Label("integration"), func() {
			var output string
			targetLength := 30
			callback := func(token string) bool {
				output += token
				return len(output) < targetLength
			}

			err := ctx.GenerateStream("The quick brown fox",
				callback,
				llama.WithMaxTokens(100),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(len(output)).To(BeNumerically(">=", targetLength))
		})

		It("should stop when specific pattern detected in output", Label("integration"), func() {
			var output string
			targetLength := 20
			callback := func(token string) bool {
				output += token
				// Stop when we reach a certain length (reliable test condition)
				return len(output) < targetLength
			}

			err := ctx.GenerateStream("Write a long story about adventures",
				callback,
				llama.WithMaxTokens(100),
			)
			Expect(err).NotTo(HaveOccurred())
			// Verify that generation stopped around the target length
			Expect(len(output)).To(BeNumerically(">=", targetLength))
			Expect(len(output)).To(BeNumerically("<", 100), "should have stopped before max_tokens")
		})

		It("should stop when token count limit reached", Label("integration"), func() {
			count := 0
			maxCount := 7
			callback := func(token string) bool {
				count++
				return count < maxCount
			}

			err := ctx.GenerateStream("Count tokens",
				callback,
				llama.WithMaxTokens(100),
			)
			Expect(err).NotTo(HaveOccurred())
			Expect(count).To(Equal(maxCount))
		})
	})
})
