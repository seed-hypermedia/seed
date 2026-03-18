import {appendChatTextPart, appendChatToolCalls, applyChatToolResults, buildLegacyChatMessageParts} from '../chat-parts'
import {describe, expect, it} from 'vitest'

describe('chat parts', () => {
  it('preserves the observed order of text and tool activity', () => {
    let parts = appendChatTextPart([], 'Looking this up.')

    parts = appendChatToolCalls(parts, [
      {
        id: 'tool-1',
        name: 'read',
        args: {url: 'hm://site/doc'},
      },
    ])

    parts = applyChatToolResults(parts, [
      {
        id: 'tool-1',
        name: 'read',
        result: 'Document body',
      },
    ])

    parts = appendChatTextPart(parts, 'Here is the summary.')

    expect(parts).toEqual([
      {type: 'text', text: 'Looking this up.'},
      {
        type: 'tool',
        id: 'tool-1',
        name: 'read',
        args: {url: 'hm://site/doc'},
        result: 'Document body',
      },
      {type: 'text', text: 'Here is the summary.'},
    ])
  })

  it('coalesces adjacent streamed text deltas', () => {
    const parts = appendChatTextPart(appendChatTextPart([], 'Hello'), ' world')

    expect(parts).toEqual([{type: 'text', text: 'Hello world'}])
  })

  it('builds legacy assistant parts from tool arrays and message content', () => {
    const parts = buildLegacyChatMessageParts({
      content: 'Final answer',
      toolCalls: [{id: 'tool-1', name: 'read', args: {url: 'hm://site/doc'}}],
      toolResults: [{id: 'tool-1', name: 'read', result: 'Document body'}],
    })

    expect(parts).toEqual([
      {
        type: 'tool',
        id: 'tool-1',
        name: 'read',
        args: {url: 'hm://site/doc'},
        result: 'Document body',
      },
      {type: 'text', text: 'Final answer'},
    ])
  })
})
