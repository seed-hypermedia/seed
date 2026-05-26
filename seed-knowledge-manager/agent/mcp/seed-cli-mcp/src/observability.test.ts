import {expect, test} from 'bun:test'
import {sanitizeForObservability} from './observability.js'

const redactor = (input: string) => input.split('secret-token').join('***REDACTED***')

test('observability sanitizes LLM prompts by default', () => {
  const sanitized = sanitizeForObservability(
    'llm',
    {
      model: 'deepseek-chat',
      prompt_messages: [{role: 'user', content: 'secret-token'}],
      completion: 'answer with secret-token',
      tool_calls: [{function: {name: 'seed_search', arguments: '{}'}}],
    },
    false,
    redactor,
  ) as Record<string, unknown>

  expect(sanitized.prompt_messages).toBeUndefined()
  expect(sanitized.completion).toContain('***REDACTED***')
  expect(sanitized.tool_calls).toEqual(['seed_search'])
})

test('observability can preserve redacted full payload explicitly', () => {
  const sanitized = sanitizeForObservability(
    'trace',
    {event: 'x', data: {nested: 'secret-token'}},
    true,
    redactor,
  ) as {data: {nested: string}}

  expect(sanitized.data.nested).toBe('***REDACTED***')
})
