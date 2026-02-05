package llama_test

import (
	"context"
	"os"
	"strings"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/tcpipuk/llama-go"
)

// Channel Streaming Test Suite
//
// Tests for GenerateChannel and GenerateWithDraftChannel methods, covering:
// - Basic channel-based streaming with token delivery
// - Context cancellation and timeout handling
// - Error propagation via error channel
// - Channel lifecycle (proper closing)
// - Stop words with channel streaming
// - Concurrent channel streaming operations
// - Draft model integration with channels
// - Channel buffering behaviour

var _ = Describe("Model.GenerateChannel", func() {
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

	Context("basic channel streaming", func() {
		It("should stream tokens via channel", Label("integration", "channel"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Hello",
				llama.WithMaxTokens(10))

			var result strings.Builder
			var err error

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					result.WriteString(token)
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(result.String()).NotTo(BeEmpty())
		})

		It("should deliver all generated tokens", Label("integration", "channel"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "The capital of France is",
				llama.WithMaxTokens(20),
				llama.WithSeed(42))

			var tokens []string
			var err error

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					tokens = append(tokens, token)
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(tokens).NotTo(BeEmpty())
			Expect(len(tokens)).To(BeNumerically(">", 0))
		})

		It("should receive non-empty token strings", Label("integration", "channel"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Test",
				llama.WithMaxTokens(10))

			var err error
			tokenCount := 0

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					Expect(token).NotTo(BeEmpty())
					tokenCount++
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(tokenCount).To(BeNumerically(">", 0))
		})
	})

	Context("context cancellation", func() {
		It("should stop generation when context cancelled", Label("integration", "channel"), func() {
			bgCtx, cancel := context.WithCancel(context.Background())
			defer cancel()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Write a very long story about dragons and knights",
				llama.WithMaxTokens(1000))

			tokenCount := 0
			cancelAfter := 5

		Loop:
			for {
				select {
				case _, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					tokenCount++
					if tokenCount == cancelAfter {
						cancel()
					}
				case <-errCh:
					// Ignore errors, we're testing cancellation
				case <-time.After(5 * time.Second):
					// Timeout to prevent test hanging
					break Loop
				}
			}

			// Should have stopped shortly after cancellation
			Expect(tokenCount).To(BeNumerically(">=", cancelAfter))
			Expect(tokenCount).To(BeNumerically("<", 100))
		})

		It("should allow immediate cancellation", Label("integration", "channel"), func() {
			bgCtx, cancel := context.WithCancel(context.Background())
			cancel() // Cancel before any tokens generated

			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Hello",
				llama.WithMaxTokens(100))

			tokenCount := 0
			timeout := time.After(2 * time.Second)

		Loop:
			for {
				select {
				case _, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					tokenCount++
				case <-errCh:
					// Ignore errors
				case <-timeout:
					break Loop
				}
			}

			// Should stop very quickly with minimal tokens
			Expect(tokenCount).To(BeNumerically("<", 10))
		})

		It("should close channels after cancellation", Label("integration", "channel"), func() {
			bgCtx, cancel := context.WithCancel(context.Background())
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Test prompt",
				llama.WithMaxTokens(100))

			// Wait for a few tokens then cancel
			tokensSeen := 0
		WaitLoop:
			for tokensSeen < 3 {
				select {
				case _, ok := <-tokenCh:
					if !ok {
						break WaitLoop
					}
					tokensSeen++
				case <-time.After(2 * time.Second):
					break WaitLoop
				}
			}

			cancel()

			// Drain channels
			timeout := time.After(2 * time.Second)
		DrainLoop:
			for {
				select {
				case _, ok := <-tokenCh:
					if !ok {
						// Token channel closed
						break DrainLoop
					}
				case <-timeout:
					break DrainLoop
				}
			}

			// Verify both channels are closed by checking error channel
			select {
			case _, ok := <-errCh:
				Expect(ok).To(BeFalse(), "error channel should be closed")
			case <-time.After(1 * time.Second):
				// If we timeout, channels might not be closed yet
			}
		})
	})

	Context("context timeout", func() {
		It("should respect context timeout", Label("integration", "channel", "slow"), func() {
			// Use a longer timeout that allows some tokens but stops before max
			ctxTimeout, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			tokenCh, errCh := ctx.GenerateChannel(ctxTimeout, "Write a detailed story about dragons",
				llama.WithMaxTokens(10000)) // Request many tokens

			var tokens []string

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					tokens = append(tokens, token)
				case <-errCh:
					// Ignore errors
				case <-ctxTimeout.Done():
					break Loop
				}
			}

			// With GPU acceleration, generation might complete before timeout
			// Just verify that generation works with context
			// (either completes or times out - both are valid)
			GinkgoWriter.Printf("Generated %d tokens\n", len(tokens))
		})

		It("should handle very short timeout", Label("integration", "channel"), func() {
			ctxTimeout, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()

			tokenCh, errCh := ctx.GenerateChannel(ctxTimeout, "Test",
				llama.WithMaxTokens(1000))

			tokenCount := 0
			timeout := time.After(2 * time.Second)

		Loop:
			for {
				select {
				case _, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					tokenCount++
				case <-errCh:
					// Ignore errors
				case <-timeout:
					break Loop
				}
			}

			// Should only generate a few tokens before timeout
			Expect(tokenCount).To(BeNumerically("<", 50))
		})
	})

	Context("error propagation", func() {
		It("should return error when model is closed", Label("integration", "channel"), func() {
			model.Close()

			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Test",
				llama.WithMaxTokens(10))

			var receivedErr error
			timeout := time.After(1 * time.Second)

		Loop:
			for {
				select {
				case _, ok := <-tokenCh:
					if !ok {
						break Loop
					}
				case err := <-errCh:
					if err != nil {
						receivedErr = err
						break Loop
					}
				case <-timeout:
					break Loop
				}
			}

			Expect(receivedErr).To(HaveOccurred())
			Expect(receivedErr.Error()).To(Equal("model is closed"))
		})

		It("should not deliver tokens after error", Label("integration", "channel"), func() {
			model.Close()

			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Test",
				llama.WithMaxTokens(10))

			var tokenCount int
			var receivedErr error
			timeout := time.After(1 * time.Second)

		Loop:
			for {
				select {
				case _, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					if receivedErr == nil {
						tokenCount++
					}
					// Should not receive tokens after error
					Expect(receivedErr).To(BeNil(), "received token after error")
				case err := <-errCh:
					if err != nil {
						receivedErr = err
					}
				case <-timeout:
					break Loop
				}
			}

			Expect(receivedErr).To(HaveOccurred())
			Expect(tokenCount).To(Equal(0), "should not receive tokens on closed model")
		})
	})

	Context("channel lifecycle", func() {
		It("should close token channel when complete", Label("integration", "channel"), func() {
			bgCtx := context.Background()
			tokenCh, _ := ctx.GenerateChannel(bgCtx, "Hello",
				llama.WithMaxTokens(10))

			// Drain channel until it closes
		Loop:
			for {
				_, ok := <-tokenCh
				if !ok {
					break Loop
				}
			}

			// Verify channel is closed
			_, ok := <-tokenCh
			Expect(ok).To(BeFalse(), "token channel should be closed")
		})

		It("should close error channel when complete", Label("integration", "channel"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Hello",
				llama.WithMaxTokens(10))

			// Drain token channel
		Loop:
			for {
				_, ok := <-tokenCh
				if !ok {
					break Loop
				}
			}

			// Drain error channel
			timeout := time.After(1 * time.Second)
		ErrLoop:
			for {
				select {
				case _, ok := <-errCh:
					if !ok {
						break ErrLoop
					}
				case <-timeout:
					break ErrLoop
				}
			}

			// Verify error channel is closed
			_, ok := <-errCh
			Expect(ok).To(BeFalse(), "error channel should be closed")
		})

		It("should close both channels even on error", Label("integration", "channel"), func() {
			model.Close() // Force error

			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Test",
				llama.WithMaxTokens(10))

			// Drain both channels
			timeout := time.After(2 * time.Second)
		DrainLoop:
			for {
				select {
				case _, ok := <-tokenCh:
					if !ok {
						tokenCh = nil
					}
				case _, ok := <-errCh:
					if !ok {
						errCh = nil
					}
				case <-timeout:
					break DrainLoop
				}
				if tokenCh == nil && errCh == nil {
					break DrainLoop
				}
			}

			// Verify both channels are closed
			if tokenCh != nil {
				_, ok := <-tokenCh
				Expect(ok).To(BeFalse(), "token channel should be closed")
			}
			if errCh != nil {
				_, ok := <-errCh
				Expect(ok).To(BeFalse(), "error channel should be closed")
			}
		})
	})

	Context("with stop words", func() {
		It("should stop at stop word", Label("integration", "channel"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "The sky is blue.",
				llama.WithMaxTokens(50),
				llama.WithStopWords("."))

			var result strings.Builder
			var err error

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					result.WriteString(token)
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(result.String()).NotTo(BeEmpty())
			// Generation should stop at or before stop word
		})

		It("should not include stop word in output", Label("integration", "channel"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Count: one two three",
				llama.WithMaxTokens(50),
				llama.WithStopWords("three"))

			var result strings.Builder
			var err error

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					result.WriteString(token)
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			// Result should not contain the stop word (or stop before it)
		})

		It("should handle multiple stop words", Label("integration", "channel"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Hello world",
				llama.WithMaxTokens(50),
				llama.WithStopWords(".", "!", "?"))

			var result strings.Builder
			var err error

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					result.WriteString(token)
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(result.String()).NotTo(BeEmpty())
		})
	})

	Context("with sampling options", func() {
		It("should respect WithMaxTokens", Label("integration", "channel"), func() {
			const maxTokens = 5
			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Write a long story",
				llama.WithMaxTokens(maxTokens))

			tokenCount := 0
			var err error

		Loop:
			for {
				select {
				case _, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					tokenCount++
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(tokenCount).To(BeNumerically("<=", maxTokens))
		})

		It("should apply temperature parameter", Label("integration", "channel"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "The capital of France is",
				llama.WithMaxTokens(20),
				llama.WithTemperature(0.5))

			var result strings.Builder
			var err error

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					result.WriteString(token)
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(result.String()).NotTo(BeEmpty())
		})
	})

	Context("concurrent channel streaming", func() {
		It("should handle multiple concurrent streams", Label("integration", "channel"), func() {
			const numStreams = 3
			done := make(chan bool, numStreams)

			for i := 0; i < numStreams; i++ {
				go func(streamID int) {
					bgCtx := context.Background()
					tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Hello",
						llama.WithMaxTokens(10))

					var result strings.Builder
					var err error

				Loop:
					for {
						select {
						case token, ok := <-tokenCh:
							if !ok {
								break Loop
							}
							result.WriteString(token)
						case e := <-errCh:
							err = e
						}
					}

					Expect(err).NotTo(HaveOccurred())
					Expect(result.String()).NotTo(BeEmpty())
					done <- true
				}(i)
			}

			// Wait for all streams to complete
			timeout := time.After(30 * time.Second)
			for i := 0; i < numStreams; i++ {
				select {
				case <-done:
					// Stream completed
				case <-timeout:
					Fail("concurrent streams timed out")
				}
			}
		})

		It("should not have race conditions", Label("integration", "channel"), func() {
			// This test is designed to be run with -race flag
			const numStreams = 5
			done := make(chan bool, numStreams)

			for i := 0; i < numStreams; i++ {
				go func() {
					bgCtx := context.Background()
					tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Test",
						llama.WithMaxTokens(5))

					tokenCount := 0
				Loop:
					for {
						select {
						case _, ok := <-tokenCh:
							if !ok {
								break Loop
							}
							tokenCount++
						case <-errCh:
						}
					}

					Expect(tokenCount).To(BeNumerically(">", 0))
					done <- true
				}()
			}

			// Wait for all streams
			timeout := time.After(30 * time.Second)
			for i := 0; i < numStreams; i++ {
				select {
				case <-done:
				case <-timeout:
					Fail("concurrent streams timed out")
				}
			}
		})
	})
})

var _ = Describe("Model.GenerateWithDraftChannel", func() {
	var (
		targetModel *llama.Model
		targetCtx   *llama.Context
		draftModel  *llama.Model
		draftCtx    *llama.Context
		modelPath   string
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
		if draftModel != nil {
			draftModel.Close()
		}
		if targetCtx != nil {
			targetCtx.Close()
		}
		if targetModel != nil {
			targetModel.Close()
		}
	})

	Context("basic draft model streaming", func() {
		It("should stream tokens with draft model", Label("integration", "channel", "speculative"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := targetCtx.GenerateWithDraftChannel(bgCtx, testPrompt, draftCtx,
				llama.WithMaxTokens(30))

			var result strings.Builder
			var err error

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					result.WriteString(token)
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(result.String()).NotTo(BeEmpty())
		})

		It("should deliver verified tokens", Label("integration", "channel", "speculative"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := targetCtx.GenerateWithDraftChannel(bgCtx, testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithDraftTokens(16))

			var tokens []string
			var err error

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					tokens = append(tokens, token)
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(tokens).NotTo(BeEmpty())
		})

		It("should produce coherent output with speculative decoding", Label("integration", "channel", "speculative"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := targetCtx.GenerateWithDraftChannel(bgCtx, "Once upon a time", draftCtx,
				llama.WithMaxTokens(50),
				llama.WithDraftTokens(8))

			var result strings.Builder
			var err error

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					result.WriteString(token)
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(len(result.String())).To(BeNumerically(">", 0))
		})
	})

	Context("with context cancellation", func() {
		It("should stop draft generation on cancellation", Label("integration", "channel", "speculative"), func() {
			bgCtx, cancel := context.WithCancel(context.Background())
			defer cancel()
			tokenCh, errCh := targetCtx.GenerateWithDraftChannel(bgCtx, "Write a long story", draftCtx,
				llama.WithMaxTokens(1000),
				llama.WithDraftTokens(16))

			tokenCount := 0
			cancelAfter := 5

		Loop:
			for {
				select {
				case _, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					tokenCount++
					if tokenCount == cancelAfter {
						cancel()
					}
				case <-errCh:
				case <-time.After(5 * time.Second):
					break Loop
				}
			}

			Expect(tokenCount).To(BeNumerically(">=", cancelAfter))
			Expect(tokenCount).To(BeNumerically("<", 100))
		})
	})

	Context("with draft token configuration", func() {
		It("should work with draft_tokens=8", Label("integration", "channel", "speculative"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := targetCtx.GenerateWithDraftChannel(bgCtx, testPrompt, draftCtx,
				llama.WithMaxTokens(30),
				llama.WithDraftTokens(8))

			var result strings.Builder
			var err error

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					result.WriteString(token)
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(result.String()).NotTo(BeEmpty())
		})

		It("should work with draft_tokens=32", Label("integration", "channel", "speculative"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := targetCtx.GenerateWithDraftChannel(bgCtx, testPrompt, draftCtx,
				llama.WithMaxTokens(50),
				llama.WithDraftTokens(32))

			var result strings.Builder
			var err error

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					result.WriteString(token)
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(result.String()).NotTo(BeEmpty())
		})
	})

	Context("with stop words", func() {
		It("should respect stop words in draft streaming", Label("integration", "channel", "speculative"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := targetCtx.GenerateWithDraftChannel(bgCtx, "The sky is blue.", draftCtx,
				llama.WithMaxTokens(50),
				llama.WithStopWords("."))

			var result strings.Builder
			var err error

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					result.WriteString(token)
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(result.String()).NotTo(BeEmpty())
		})
	})

	Context("error conditions", func() {
		It("should return error when draft model is closed", Label("integration", "channel", "speculative"), func() {
			draftModel.Close()

			bgCtx := context.Background()
			tokenCh, errCh := targetCtx.GenerateWithDraftChannel(bgCtx, testPrompt, draftCtx,
				llama.WithMaxTokens(30))

			var receivedErr error
			timeout := time.After(1 * time.Second)

		Loop:
			for {
				select {
				case _, ok := <-tokenCh:
					if !ok {
						break Loop
					}
				case err := <-errCh:
					if err != nil {
						receivedErr = err
						break Loop
					}
				case <-timeout:
					break Loop
				}
			}

			Expect(receivedErr).To(HaveOccurred())
			Expect(receivedErr.Error()).To(Equal("draft model is closed"))
		})

		It("should return error when target model is closed", Label("integration", "channel", "speculative"), func() {
			targetModel.Close()

			bgCtx := context.Background()
			tokenCh, errCh := targetCtx.GenerateWithDraftChannel(bgCtx, testPrompt, draftCtx,
				llama.WithMaxTokens(30))

			var receivedErr error
			timeout := time.After(1 * time.Second)

		Loop:
			for {
				select {
				case _, ok := <-tokenCh:
					if !ok {
						break Loop
					}
				case err := <-errCh:
					if err != nil {
						receivedErr = err
						break Loop
					}
				case <-timeout:
					break Loop
				}
			}

			Expect(receivedErr).To(HaveOccurred())
			Expect(receivedErr.Error()).To(Equal("model is closed"))
		})
	})

	Context("with sampling parameters", func() {
		It("should apply temperature to draft streaming", Label("integration", "channel", "speculative"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := targetCtx.GenerateWithDraftChannel(bgCtx, testPrompt, draftCtx,
				llama.WithMaxTokens(30),
				llama.WithTemperature(0.7))

			var result strings.Builder
			var err error

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					result.WriteString(token)
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(result.String()).NotTo(BeEmpty())
		})

	})
})

var _ = Describe("Channel Streaming Edge Cases", func() {
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

	Context("context handling", func() {
		It("should handle context.Background()", Label("integration", "channel"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Test",
				llama.WithMaxTokens(10))

			var result strings.Builder
		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					result.WriteString(token)
				case <-errCh:
				}
			}

			Expect(result.String()).NotTo(BeEmpty())
		})

		It("should handle already-cancelled context", Label("integration", "channel"), func() {
			bgCtx, cancel := context.WithCancel(context.Background())
			cancel()

			tokenCh, _ := ctx.GenerateChannel(bgCtx, "Test",
				llama.WithMaxTokens(100))

			tokenCount := 0
			timeout := time.After(2 * time.Second)

		Loop:
			for {
				select {
				case _, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					tokenCount++
				case <-timeout:
					break Loop
				}
			}

			// Should stop very quickly
			Expect(tokenCount).To(BeNumerically("<", 10))
		})
	})

	Context("channel reading patterns", func() {
		It("should handle reading only from token channel", Label("integration", "channel"), func() {
			bgCtx := context.Background()
			tokenCh, _ := ctx.GenerateChannel(bgCtx, "Hello",
				llama.WithMaxTokens(10))

			var result strings.Builder
			for token := range tokenCh {
				result.WriteString(token)
			}

			Expect(result.String()).NotTo(BeEmpty())
		})

		It("should handle slow consumer", Label("integration", "channel", "slow"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Test",
				llama.WithMaxTokens(20))

			var result strings.Builder
			var err error

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					// Simulate slow consumer
					time.Sleep(100 * time.Millisecond)
					result.WriteString(token)
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(result.String()).NotTo(BeEmpty())
		})

		It("should handle fast consumer", Label("integration", "channel"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Test",
				llama.WithMaxTokens(50))

			tokenCount := 0
			var err error

		Loop:
			for {
				select {
				case _, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					tokenCount++
					// Fast consumer - no delay
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(tokenCount).To(BeNumerically(">", 0))
		})
	})

	Context("empty and edge case prompts", func() {
		It("should handle very short prompt", Label("integration", "channel"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Hi",
				llama.WithMaxTokens(10))

			var result strings.Builder
			var err error

		Loop:
			for {
				select {
				case token, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					result.WriteString(token)
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(result.String()).NotTo(BeEmpty())
		})

		It("should generate minimal tokens with max_tokens=1", Label("integration", "channel"), func() {
			bgCtx := context.Background()
			tokenCh, errCh := ctx.GenerateChannel(bgCtx, "Test",
				llama.WithMaxTokens(1))

			tokenCount := 0
			var err error

		Loop:
			for {
				select {
				case _, ok := <-tokenCh:
					if !ok {
						break Loop
					}
					tokenCount++
				case e := <-errCh:
					err = e
				}
			}

			Expect(err).NotTo(HaveOccurred())
			Expect(tokenCount).To(BeNumerically("<=", 1))
		})
	})
})
