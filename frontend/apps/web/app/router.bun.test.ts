import {describe, expect, test} from 'bun:test'
import {describeDocumentRoute} from './router-utils'

describe('TanStack document route adapter', () => {
  test('describes a gateway document with a comments suffix', () => {
    expect(
      describeDocumentRoute(
        'hm/alice/docs/:comments/comment123',
        'https://seed.test/hm/alice/docs/:comments/comment123',
      ),
    ).toMatchObject({
      runtime: 'bun',
      router: 'tanstack-router',
      isGatewayDocument: true,
      documentUid: 'alice',
      documentPath: ['docs'],
      viewTerm: 'comments',
      openComment: 'comment123',
    })
  })

  test('describes an inspect ipfs route', () => {
    expect(
      describeDocumentRoute('inspect/ipfs/bafy/file.png', 'https://seed.test/inspect/ipfs/bafy/file.png'),
    ).toMatchObject({
      inspectIpfsPath: 'bafy/file.png',
      loaderDeps: {
        pathname: '/inspect/ipfs/bafy/file.png',
        version: null,
        latest: true,
      },
    })
  })
})
