import {deserialize} from 'superjson'
import {describe, expect, it} from 'vitest'
import {wrapJSON} from './wrapping.server'

describe('wrapJSON', () => {
  it('returns a standard Response with a SuperJSON payload', async () => {
    const response = wrapJSON({createdAt: new Date('2024-01-02T03:04:05.000Z')})

    expect(response).toBeInstanceOf(Response)
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache')

    const payload = await response.json()
    expect(deserialize(payload)).toEqual({createdAt: new Date('2024-01-02T03:04:05.000Z')})
  })

  it('preserves caller-provided response init values', async () => {
    const response = wrapJSON('missing', {
      status: 404,
      headers: {
        'Cache-Control': 'public, max-age=60',
        'X-Seed-Test': 'yes',
      },
    })

    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60')
    expect(response.headers.get('X-Seed-Test')).toBe('yes')
    expect(deserialize(await response.json())).toBe('missing')
  })
})
