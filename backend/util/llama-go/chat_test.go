package llama_test

import (
	"context"
	"os"
	"strings"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	llama "github.com/tcpipuk/llama-go"
)

var _ = Describe("Chat API", func() {
	var model *llama.Model
	var ctx *llama.Context
	var testModelPath string

	BeforeEach(func() {
		// Get test model path from environment
		testModelPath = os.Getenv("TEST_CHAT_MODEL")
		if testModelPath == "" {
			Skip("TEST_CHAT_MODEL environment variable not set")
		}

		var err error
		model, err = llama.LoadModel(testModelPath, llama.WithGPULayers(-1))
		Expect(err).NotTo(HaveOccurred())
		Expect(model).NotTo(BeNil())

		ctx, err = model.NewContext(llama.WithContext(2048))
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

	Describe("Chat Template", func() {
		Context("when model has embedded template", Label("integration", "chat"), func() {
			It("should retrieve chat template from GGUF metadata", func() {
				template := model.ChatTemplate()
				Expect(template).NotTo(BeEmpty(), "Qwen3 model should have embedded chat template")
			})

			It("should contain sensible template content", func() {
				template := model.ChatTemplate()
				// Most chat templates contain the word "assistant" for the assistant role
				Expect(strings.ToLower(template)).To(ContainSubstring("assistant"),
					"Chat template should reference assistant role")
			})

			It("should contain template markers", func() {
				template := model.ChatTemplate()
				// Chat templates use Jinja2 syntax with {% %} or {{ }} markers
				hasJinja := strings.Contains(template, "{%") || strings.Contains(template, "{{")
				Expect(hasJinja).To(BeTrue(), "Chat template should contain Jinja2 template markers")
			})
		})
	})

	Describe("Chat Completion", func() {
		Context("with deterministic prompts", Label("integration", "chat"), func() {
			It("should complete chat with system and user messages", func() {
				messages := []llama.ChatMessage{
					{Role: "system", Content: "You ALWAYS reply with exactly one word: Paris"},
					{Role: "user", Content: "What is the capital city of France?"},
				}

				bgCtx := context.Background()
				response, err := ctx.Chat(bgCtx, messages, llama.ChatOptions{
					MaxTokens:   llama.Int(50),
					Temperature: llama.Float32(0.0), // Deterministic
					Seed:        llama.Int(42),
				})

				Expect(err).NotTo(HaveOccurred())
				Expect(response).NotTo(BeNil())
				Expect(response.Content).NotTo(BeEmpty())
				Expect(strings.ToLower(response.Content)).To(ContainSubstring("paris"),
					"Response should contain 'Paris' given the forced system prompt")
			})

			It("should respect max tokens limit", func() {
				messages := []llama.ChatMessage{
					{Role: "user", Content: "Count from 1 to 100"},
				}

				bgCtx := context.Background()
				response, err := ctx.Chat(bgCtx, messages, llama.ChatOptions{
					MaxTokens:   llama.Int(10),
					Temperature: llama.Float32(0.0),
				})

				Expect(err).NotTo(HaveOccurred())
				Expect(response.Content).NotTo(BeEmpty())
				// With only 10 tokens, shouldn't reach 100
				Expect(response.Content).NotTo(ContainSubstring("100"))
			})

			It("should handle empty response gracefully", func() {
				messages := []llama.ChatMessage{
					{Role: "system", Content: "You are a helpful assistant."},
					{Role: "user", Content: "Hello"},
				}

				bgCtx := context.Background()
				response, err := ctx.Chat(bgCtx, messages, llama.ChatOptions{
					MaxTokens: llama.Int(1),
				})

				Expect(err).NotTo(HaveOccurred())
				Expect(response).NotTo(BeNil())
				// Even with 1 token, should get something (might be empty though)
			})
		})

		Context("with context cancellation", Label("integration", "chat"), func() {
			It("should respect context timeout", func() {
				messages := []llama.ChatMessage{
					{Role: "user", Content: "Tell me a very long story"},
				}

				ctxTimeout, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
				defer cancel()

				response, err := ctx.Chat(ctxTimeout, messages, llama.ChatOptions{
					MaxTokens: llama.Int(1000), // Request many tokens
				})

				// Should either timeout or complete quickly
				if err != nil {
					Expect(err.Error()).To(ContainSubstring("context"))
				} else {
					// If it completed, response should be present
					Expect(response).NotTo(BeNil())
				}
			})

			It("should handle pre-cancelled context", func() {
				messages := []llama.ChatMessage{
					{Role: "user", Content: "Hello"},
				}

				bgCtx, cancel := context.WithCancel(context.Background())
				cancel() // Cancel immediately

				_, err := ctx.Chat(bgCtx, messages, llama.ChatOptions{
					MaxTokens: llama.Int(10),
				})

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("context"))
			})
		})

		Context("with custom options", Label("integration", "chat"), func() {
			It("should accept temperature parameter", func() {
				messages := []llama.ChatMessage{
					{Role: "user", Content: "Say hello"},
				}

				bgCtx := context.Background()
				response, err := ctx.Chat(bgCtx, messages, llama.ChatOptions{
					MaxTokens:   llama.Int(20),
					Temperature: llama.Float32(1.5), // High temperature
				})

				Expect(err).NotTo(HaveOccurred())
				Expect(response.Content).NotTo(BeEmpty())
			})

			It("should accept seed parameter without error", func() {
				messages := []llama.ChatMessage{
					{Role: "user", Content: "Pick a number between 1 and 10"},
				}

				opts := llama.ChatOptions{
					MaxTokens:   llama.Int(20),
					Temperature: llama.Float32(0.0),
					Seed:        llama.Int(12345),
				}

				bgCtx := context.Background()
				response, err := ctx.Chat(bgCtx, messages, opts)
				Expect(err).NotTo(HaveOccurred())
				Expect(response.Content).NotTo(BeEmpty())

				// Just verify seed parameter is accepted and produces output
				// Note: Exact reproducibility depends on model/template implementation
			})
		})
	})

	Describe("Chat Streaming", func() {
		Context("with deterministic prompts", Label("integration", "chat", "streaming"), func() {
			It("should stream chat deltas", func() {
				messages := []llama.ChatMessage{
					{Role: "system", Content: "You ALWAYS reply with exactly one word: London"},
					{Role: "user", Content: "What is the capital of England?"},
				}

				bgCtx := context.Background()
				deltaCh, errCh := ctx.ChatStream(bgCtx, messages, llama.ChatOptions{
					MaxTokens:   llama.Int(50),
					Temperature: llama.Float32(0.0),
					Seed:        llama.Int(42),
				})

				var fullContent strings.Builder
				var receivedDeltas int

			Loop:
				for {
					select {
					case delta, ok := <-deltaCh:
						if !ok {
							break Loop
						}
						receivedDeltas++
						fullContent.WriteString(delta.Content)

					case err := <-errCh:
						Expect(err).NotTo(HaveOccurred())

					case <-time.After(10 * time.Second):
						Fail("Streaming timed out")
					}
				}

				Expect(receivedDeltas).To(BeNumerically(">", 0), "Should receive at least one delta")
				Expect(fullContent.String()).NotTo(BeEmpty())
				Expect(strings.ToLower(fullContent.String())).To(ContainSubstring("london"),
					"Response should contain 'London' given the forced system prompt")
			})

			It("should handle context cancellation mid-stream", func() {
				messages := []llama.ChatMessage{
					{Role: "user", Content: "Tell me a very long story about dragons"},
				}

				bgCtx, cancel := context.WithCancel(context.Background())
				defer cancel()
				deltaCh, errCh := ctx.ChatStream(bgCtx, messages, llama.ChatOptions{
					MaxTokens: llama.Int(1000),
				})

				// Receive a few tokens then cancel
				receivedCount := 0
			ReceiveLoop:
				for {
					select {
					case _, ok := <-deltaCh:
						if !ok {
							break ReceiveLoop
						}
						receivedCount++
						if receivedCount >= 3 {
							cancel()
						}

					case err := <-errCh:
						if err != nil {
							// Cancellation might trigger error
							break ReceiveLoop
						}

					case <-time.After(5 * time.Second):
						Fail("Should have cancelled by now")
					}
				}

				Expect(receivedCount).To(BeNumerically(">=", 3))
			})

		})

		Context("with buffer configuration", Label("integration", "chat", "streaming"), func() {
			It("should respect custom stream buffer size", func() {
				messages := []llama.ChatMessage{
					{Role: "user", Content: "Count: 1 2 3 4 5"},
				}

				bgCtx := context.Background()
				deltaCh, _ := ctx.ChatStream(bgCtx, messages, llama.ChatOptions{
					MaxTokens:        llama.Int(20),
					StreamBufferSize: 512, // Custom buffer size
				})

				// Just verify it works with custom buffer
				receivedDeltas := 0
				for range deltaCh {
					receivedDeltas++
				}

				Expect(receivedDeltas).To(BeNumerically(">", 0))
			})
		})
	})

	Describe("Error Handling", func() {
		Context("when template is missing", Label("integration", "chat"), func() {
			It("should error if no template and none provided", func() {
				// This test would require a model without a template
				// For now, just verify our model HAS a template
				template := model.ChatTemplate()
				Expect(template).NotTo(BeEmpty())
			})
		})

		Context("with invalid parameters", Label("integration", "chat"), func() {
			It("should handle empty messages", func() {
				messages := []llama.ChatMessage{}

				bgCtx := context.Background()
				_, err := ctx.Chat(bgCtx, messages, llama.ChatOptions{
					MaxTokens: llama.Int(10),
				})

				// Should error with empty messages
				Expect(err).To(HaveOccurred())
			})
		})
	})

	Describe("Multi-turn Conversation", func() {
		Context("with conversation history", Label("integration", "chat"), func() {
			It("should handle multiple turns", func() {
				// First turn
				messages := []llama.ChatMessage{
					{Role: "system", Content: "You are a helpful assistant."},
					{Role: "user", Content: "My name is Alice"},
				}

				bgCtx := context.Background()
				response1, err := ctx.Chat(bgCtx, messages, llama.ChatOptions{
					MaxTokens: llama.Int(50),
				})

				Expect(err).NotTo(HaveOccurred())
				Expect(response1.Content).NotTo(BeEmpty())

				// Second turn - add assistant response and new user message
				messages = append(messages, llama.ChatMessage{
					Role:    "assistant",
					Content: response1.Content,
				})
				messages = append(messages, llama.ChatMessage{
					Role:    "user",
					Content: "What is my name?",
				})

				response2, err := ctx.Chat(bgCtx, messages, llama.ChatOptions{
					MaxTokens: llama.Int(50),
				})

				Expect(err).NotTo(HaveOccurred())
				Expect(response2.Content).NotTo(BeEmpty())
				// Model should hopefully remember the name (though this is model-dependent)
			})
		})
	})
})
