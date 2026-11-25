import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {agentDocumentHasInstructions, migratedAgentContent} from '../agents/prompt-migration'

const card = {
  block: {id: 'c', type: 'Embed', link: 'hm://alice/agent/forecast', attributes: {view: 'Card'}},
  children: [],
}
const guide = {block: {id: 'g', type: 'Embed', link: 'hm://docs/guide', attributes: {view: 'Content'}}, children: []}
const doc = (content: unknown[]) => ({content, metadata: {}}) as unknown as HMDocument

describe('agent prompt migration', () => {
  it('a document with only tool cards (or nothing) has no instructions yet', () => {
    expect(agentDocumentHasInstructions(doc([]))).toBe(false)
    expect(agentDocumentHasInstructions(doc([card]))).toBe(false)
    // An inlined embed (the Agent Guide) is instructions; only cards list tools and pages.
    expect(agentDocumentHasInstructions(doc([guide, card]))).toBe(true)
  })

  it('puts the stored prompt first and keeps the tool cards after it', () => {
    const prompt = [{block: {id: 'p', type: 'Paragraph', text: 'Be helpful', attributes: {}}, children: []}]
    expect(migratedAgentContent(doc([card]), prompt as never)).toEqual([...prompt, card])
  })
})
