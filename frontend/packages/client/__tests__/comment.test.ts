import {describe, it, expect, vi} from 'vitest'
import {decode as cborDecode} from '@ipld/dag-cbor'
import type {HMBlockNode, HMSigner, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {createComment} from '../src/comment'

const TEST_DOC_ID: UnpackedHypermediaId = {
  id: 'hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou/test-doc',
  uid: 'z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou',
  path: ['test-doc'],
  version: null,
  blockRef: null,
  blockRange: null,
  hostname: null,
  scheme: 'hm',
  latest: true,
}

function makeSigner(): HMSigner {
  return {
    getPublicKey: async () => new Uint8Array(34).fill(7),
    sign: vi.fn(async () => new Uint8Array(64).fill(9)),
  }
}

function makeBlocks(text: string): HMBlockNode[] {
  return [
    {
      block: {
        id: 'blk-1',
        type: 'Paragraph',
        text,
        annotations: [],
      },
      children: [],
    } as HMBlockNode,
  ]
}

describe('createComment', () => {
  it('creates a publish-ready payload from content', async () => {
    const signer = makeSigner()
    const publishInput = await createComment(
      {
        content: makeBlocks('hello world'),
        docId: TEST_DOC_ID,
        docVersion: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        blobs: [{cid: 'bafyattachment', data: new Uint8Array([4, 5, 6])}],
      },
      signer,
    )

    expect(publishInput.blobs).toHaveLength(2)
    expect(publishInput.blobs[0]?.data).toBeInstanceOf(Uint8Array)
    expect(publishInput.blobs[1]).toEqual({
      cid: 'bafyattachment',
      data: new Uint8Array([4, 5, 6]),
    })

    const decodedComment = cborDecode(publishInput.blobs[0]!.data) as any
    expect(decodedComment.type).toBe('Comment')
    expect(decodedComment.path).toBe('/test-doc')
    expect(decodedComment.body[0].text).toBe('hello world')
  })

  it('supports editor-style input with quoting and trims trailing empty blocks', async () => {
    const signer = makeSigner()
    const publishInput = await createComment(
      {
        getContent: async () => ({
          blockNodes: [
            ...makeBlocks('from editor'),
            {
              block: {
                id: 'blk-empty',
                type: 'Paragraph',
                text: '',
                annotations: [],
              },
              children: [],
            } as HMBlockNode,
          ],
          blobs: [{cid: 'bafyeditor', data: new Uint8Array([8, 9])}],
        }),
        docId: TEST_DOC_ID,
        docVersion: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        quotingBlockId: 'quoted-block',
      },
      signer,
    )

    const decodedComment = cborDecode(publishInput.blobs[0]!.data) as any
    expect(decodedComment.body).toHaveLength(1)
    expect(decodedComment.body[0].type).toBe('Embed')
    expect(decodedComment.body[0].children).toHaveLength(1)
    expect(decodedComment.body[0].children[0].text).toBe('from editor')
    expect(publishInput.blobs[1]).toEqual({
      cid: 'bafyeditor',
      data: new Uint8Array([8, 9]),
    })
  })
})
