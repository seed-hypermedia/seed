import {describe, expect, it} from 'vitest'
import {asResponse, createActionArgs, createLoaderArgs} from './route-test-utils'
import {action, loader} from './routes/hm.api.notifications'

describe('hm.api.notifications loader', () => {
  it('returns a CORS preflight response for OPTIONS requests', async () => {
    const response = asResponse(
      await loader(
        createLoaderArgs(
          new Request('http://localhost/hm/api/notifications', {
            method: 'OPTIONS',
          }),
        ),
      ),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type')
  })

  it('rejects non-OPTIONS loader requests', async () => {
    const response = asResponse(await loader(createLoaderArgs(new Request('http://localhost/hm/api/notifications'))))

    expect(response.status).toBe(405)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('adds CORS headers to action error responses', async () => {
    const response = asResponse(
      await action(
        createActionArgs(
          new Request('http://localhost/hm/api/notifications', {
            method: 'POST',
            body: new Uint8Array([1, 2, 3]) as BufferSource,
            headers: {'Content-Type': 'application/cbor'},
          }),
        ),
      ),
    )

    expect(response.status).toBe(500)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})
