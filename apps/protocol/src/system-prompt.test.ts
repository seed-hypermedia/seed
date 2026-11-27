import {describe, expect, test} from 'bun:test'
import {seedAssistantSystemPrompt} from './index'

describe('what every agent is told about building apps and tools', () => {
  test('sends the agent to the documentation pages before the write guide', () => {
    const prompt = seedAssistantSystemPrompt()
    const line = prompt.split('\n').find((part) => part.startsWith('Apps and tools:'))!
    // The app page is the way in, and its links lead to the page of each part.
    expect(line).toContain('Read hm://hyper.media/app, then the pages it links')
    expect(line).toContain('hm://hyper.media/tool for a tool')
    expect(line.indexOf('hm://hyper.media/app')).toBeLessThan(line.indexOf('~/tools/write/apps'))
    // What makes a tool usable by others is said up front: its description and its documentation.
    expect(line).toContain('a precise name and description, its documentation as the document body')
    // A tool no longer has to live in an app.
    expect(prompt).not.toContain('apps are the only home for pages and tools')
  })
})
