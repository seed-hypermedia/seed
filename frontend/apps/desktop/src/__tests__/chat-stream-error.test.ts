import {NoOutputGeneratedError} from 'ai'
import {describe, expect, it} from 'vitest'
import {resolveChatStreamError} from '../chat-stream-error'

describe('resolveChatStreamError', () => {
  it('prefers the provider stream error over the generic no-output wrapper', () => {
    const providerError = new Error('Quota exceeded for model gemini-3.1-pro.')
    const wrappedError = new NoOutputGeneratedError({
      message: 'No output generated. Check the stream for errors.',
    })

    expect(resolveChatStreamError(wrappedError, providerError)).toBe(providerError)
  })

  it('falls back to the wrapped cause when no stream error was captured', () => {
    const cause = new Error('Provider request failed.')
    const wrappedError = new NoOutputGeneratedError({
      message: 'No output generated. Check the stream for errors.',
      cause,
    })

    expect(resolveChatStreamError(wrappedError)).toBe(cause)
  })

  it('keeps non-wrapper errors unchanged', () => {
    const error = new Error('Session not found')

    expect(resolveChatStreamError(error)).toBe(error)
  })
})
