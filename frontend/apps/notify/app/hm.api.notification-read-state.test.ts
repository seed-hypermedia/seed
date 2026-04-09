import {describe, expect, it} from 'vitest'
import {asResponse, createActionArgs, createLoaderArgs} from './route-test-utils'
import {loader, action} from './routes/hm.api.notification-read-state'

describe('hm.api.notification-read-state route', () => {
  it('returns a CORS preflight response for OPTIONS requests', async () => {
    const response = asResponse(
      await loader(
        createLoaderArgs(
          new Request('http://localhost/hm/api/notification-read-state', {
            method: 'OPTIONS',
          }),
        ),
      ),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('adds CORS headers to action error responses', async () => {
    const response = asResponse(
      await action(
        createActionArgs(
          new Request('http://localhost/hm/api/notification-read-state', {
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
