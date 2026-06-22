import {describe, expect, it} from 'vitest'
import {canonicalModelId, curateProviderModels, isChatModel} from '../model-utils'

const m = (id: string, name?: string) => ({id, name: name ?? id})

describe('isChatModel', () => {
  it('keeps text generation models', () => {
    expect(isChatModel('gpt-4o')).toBe(true)
    expect(isChatModel('claude-sonnet-4-5')).toBe(true)
    expect(isChatModel('gemini-2.0-flash')).toBe(true)
    expect(isChatModel('o3-mini')).toBe(true)
  })

  it('drops embedding, audio, image, and other non-chat models', () => {
    expect(isChatModel('text-embedding-3-small')).toBe(false)
    expect(isChatModel('text-embedding-ada-002')).toBe(false)
    expect(isChatModel('whisper-1')).toBe(false)
    expect(isChatModel('tts-1-hd')).toBe(false)
    expect(isChatModel('dall-e-3')).toBe(false)
    expect(isChatModel('gpt-image-1')).toBe(false)
    expect(isChatModel('gpt-4o-realtime-preview')).toBe(false)
    expect(isChatModel('omni-moderation-latest')).toBe(false)
    expect(isChatModel('gpt-3.5-turbo-instruct')).toBe(false)
    expect(isChatModel('davinci-002')).toBe(false)
  })
})

describe('canonicalModelId', () => {
  it('collapses dated snapshots onto their stable alias', () => {
    expect(canonicalModelId('gpt-4o-2024-08-06')).toBe('gpt-4o')
    expect(canonicalModelId('gpt-4o-mini-2024-07-18')).toBe('gpt-4o-mini')
    expect(canonicalModelId('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet')
    expect(canonicalModelId('gpt-4-0125-preview')).toBe('gpt-4')
    expect(canonicalModelId('gpt-3.5-turbo-0125')).toBe('gpt-3.5-turbo')
    expect(canonicalModelId('chatgpt-4o-latest')).toBe('chatgpt-4o')
  })

  it('does not strip semantic suffixes that mark distinct models', () => {
    expect(canonicalModelId('gpt-4o-mini')).toBe('gpt-4o-mini')
    expect(canonicalModelId('o1-mini')).toBe('o1-mini')
    expect(canonicalModelId('claude-3-5-sonnet')).toBe('claude-3-5-sonnet')
  })
})

describe('curateProviderModels', () => {
  it('removes non-chat models, dedupes snapshots, and floats flagships', () => {
    const models = [
      m('text-embedding-3-small'),
      m('dall-e-3'),
      m('gpt-3.5-turbo'),
      m('gpt-3.5-turbo-0125'),
      m('gpt-4o', 'GPT-4o'),
      m('gpt-4o-2024-08-06'),
      m('gpt-4o-2024-11-20'),
      m('gpt-4o-mini'),
      m('o3'),
    ]
    const {recommended, all, hasMore} = curateProviderModels(models, 'openai')

    // Embeddings/images are gone from both lists.
    expect(all.some((model) => model.id === 'text-embedding-3-small')).toBe(false)
    expect(all.some((model) => model.id === 'dall-e-3')).toBe(false)

    // Recommended collapses the three gpt-4o entries to the stable alias.
    const recommendedIds = recommended.map((model) => model.id)
    expect(recommendedIds.filter((id) => id.startsWith('gpt-4o') && !id.includes('mini'))).toEqual(['gpt-4o'])
    expect(recommendedIds).toContain('gpt-4o-mini')
    expect(recommendedIds).toContain('gpt-3.5-turbo')
    expect(recommendedIds).not.toContain('gpt-3.5-turbo-0125')

    // Flagships sort ahead of older families.
    expect(recommendedIds.indexOf('gpt-4o')).toBeLessThan(recommendedIds.indexOf('gpt-3.5-turbo'))

    // The full list still contains snapshots, so "show all" is meaningful.
    expect(all.some((model) => model.id === 'gpt-4o-2024-08-06')).toBe(true)
    expect(hasMore).toBe(true)
  })

  it('handles an empty or missing model list', () => {
    expect(curateProviderModels(undefined, 'openai')).toEqual({recommended: [], all: [], hasMore: false})
    expect(curateProviderModels([], undefined)).toEqual({recommended: [], all: [], hasMore: false})
  })
})
