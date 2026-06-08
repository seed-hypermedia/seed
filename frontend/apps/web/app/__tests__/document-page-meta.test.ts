import {Code} from '@connectrpc/connect'
import {describe, expect, it, vi} from 'vitest'
import {wrap} from '../wrapping'

vi.mock('@/client-lazy', () => ({
  WebCommenting: () => null,
}))

import {documentPageMeta} from '../routes/$'

describe('documentPageMeta', () => {
  it('uses Private Document title for private documents', () => {
    const meta = documentPageMeta({
      data: wrap({
        daemonError: {
          code: Code.PermissionDenied,
          message: 'permission denied',
        },
      } as any),
    })

    expect(meta).toEqual([{title: 'Private Document'}])
  })

  it('keeps Not Found title for missing documents', () => {
    const meta = documentPageMeta({
      data: wrap({
        daemonError: {
          code: Code.NotFound,
          message: 'not found',
        },
      } as any),
    })

    expect(meta).toEqual([{title: 'Not Found'}])
  })
})
