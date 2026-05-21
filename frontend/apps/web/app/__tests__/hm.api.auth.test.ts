import {Code, ConnectError} from '@connectrpc/connect'
import {AuthenticateRequest} from '@shm/shared/client/grpc-types'
import {describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
}))

vi.mock('@/client.server', () => ({
  grpcClient: {
    daemon: {
      authenticate: mocks.authenticate,
    },
  },
}))

import {action} from '../routes/hm.api.auth'

function makeAuthRequest() {
  return new Request('http://localhost/hm/api/auth', {
    method: 'POST',
    headers: {'Content-Type': 'application/protobuf'},
    body: new AuthenticateRequest({
      account: new Uint8Array([1, 2, 3]),
      timestamp: BigInt(Date.now()),
      signature: new Uint8Array([4, 5, 6]),
    }).toBinary(),
  })
}

describe('/hm/api/auth action', () => {
  it('maps daemon permission denials instead of surfacing them as 500s', async () => {
    mocks.authenticate.mockRejectedValueOnce(
      new ConnectError('authentication principal is not known', Code.PermissionDenied),
    )

    const response = await action({request: makeAuthRequest(), params: {}, context: {}} as any)

    expect(response.status).toBe(403)
    expect(await response.text()).toContain('authentication principal is not known')
  })

  it('maps unavailable daemon auth errors to service unavailable', async () => {
    mocks.authenticate.mockRejectedValueOnce(new ConnectError('daemon unavailable', Code.Unavailable))

    const response = await action({request: makeAuthRequest(), params: {}, context: {}} as any)

    expect(response.status).toBe(503)
    expect(await response.text()).toContain('daemon unavailable')
  })
})
