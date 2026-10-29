import {HMPrepareDocumentChangeInputSchema} from '@seed-hypermedia/client/hm-types'
import {compareBlocksWithMap, createBlocksMap} from '@shm/shared/utils/document-changes'
import {describe, expect, it, vi} from 'vitest'
import {publishDesktopDocument} from '../publish-document'

describe('publishDesktopDocument', () => {
  it('publishes text added to an empty document as a valid plain API payload', async () => {
    const {changes} = compareBlocksWithMap(
      createBlocksMap([], ''),
      [
        {
          id: 'added',
          type: 'paragraph',
          props: {textAlignment: 'center'},
          content: [{type: 'text', text: 'New text', styles: {bold: true}}],
          children: [],
        },
      ],
      '',
    )
    const publishDocument = vi.fn(async (input) => {
      const parsed = HMPrepareDocumentChangeInputSchema.parse(input)
      const replacement = parsed.changes.find(({op}) => op.case === 'replaceBlock')
      expect(replacement?.op.value).toMatchObject({
        id: 'added',
        text: 'New text',
        attributes: {textAlignment: 'center'},
        annotations: [{type: 'Bold', starts: [0], ends: [8]}],
      })
      expect(parsed.baseVersion).toBe('empty-version')
      return {version: 'signed-version', genesis: 'genesis', generation: 1}
    })

    await publishDesktopDocument(
      {publishDocument, getSigner: vi.fn()},
      {
        signerAccountUid: 'alice',
        account: 'alice',
        path: '/empty',
        baseVersion: 'empty-version',
        changes,
      },
    )
    expect(publishDocument).toHaveBeenCalledOnce()
  })

  it('returns the signed publication identity without requiring an indexed reload', async () => {
    const result = {version: 'signed-v1', genesis: 'genesis-v1', generation: 42}
    await expect(
      publishDesktopDocument(
        {publishDocument: vi.fn(async () => result), getSigner: vi.fn()},
        {signerAccountUid: 'alice', account: 'alice', path: '/child', changes: []},
      ),
    ).resolves.toEqual(result)
  })

  it('uses the seed client PrepareDocumentChange path for existing home documents', async () => {
    const publishDocument = vi.fn().mockResolvedValue(undefined)
    const getSigner = vi.fn()

    await publishDesktopDocument(
      {
        publishDocument,
        getSigner,
      },
      {
        signerAccountUid: 'alice',
        account: 'alice',
        path: '',
        baseVersion: 'bafy-base',
        genesis: 'bafy-genesis',
        changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Home'}}}],
      },
    )

    expect(getSigner).toHaveBeenCalledWith('alice')
    expect(publishDocument).toHaveBeenCalled()
  })

  it('uses the seed client PrepareDocumentChange path for existing non-home documents', async () => {
    const publishDocument = vi.fn().mockResolvedValue(undefined)
    const getSigner = vi.fn()

    await publishDesktopDocument(
      {
        publishDocument,
        getSigner,
      },
      {
        signerAccountUid: 'alice',
        account: 'alice',
        path: '/foo',
        baseVersion: 'bafy-base',
        genesis: 'bafy-genesis',
        changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Foo'}}}],
      },
    )

    expect(getSigner).toHaveBeenCalledWith('alice')
    expect(publishDocument).toHaveBeenCalled()
  })

  it('uses the seed client path for documents without a known genesis', async () => {
    const publishDocument = vi.fn().mockResolvedValue(undefined)
    const signer = {
      getPublicKey: vi.fn(async () => new Uint8Array([1])),
      sign: vi.fn(async () => new Uint8Array([2])),
    }
    const getSigner = vi.fn(() => signer)

    await publishDesktopDocument(
      {
        publishDocument,
        getSigner,
      },
      {
        signerAccountUid: 'alice',
        account: 'alice',
        path: '/foo',
        baseVersion: 'bafy-base',
        changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Foo'}}}],
      },
    )

    expect(getSigner).toHaveBeenCalledWith('alice')
    expect(publishDocument).toHaveBeenCalledWith(
      {
        account: 'alice',
        path: '/foo',
        baseVersion: 'bafy-base',
        changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Foo'}}}],
      },
      signer,
    )
  })

  it('passes explicit generation through the seed client path', async () => {
    const publishDocument = vi.fn().mockResolvedValue(undefined)
    const signer = {
      getPublicKey: vi.fn(async () => new Uint8Array([1])),
      sign: vi.fn(async () => new Uint8Array([2])),
    }
    const getSigner = vi.fn(() => signer)

    await publishDesktopDocument(
      {
        publishDocument,
        getSigner,
      },
      {
        signerAccountUid: 'alice',
        account: 'alice',
        path: '/foo',
        baseVersion: 'bafy-base',
        genesis: 'bafy-genesis',
        generation: 123,
        changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Foo'}}}],
      },
    )

    expect(getSigner).toHaveBeenCalledWith('alice')
    expect(publishDocument).toHaveBeenCalledWith(
      {
        account: 'alice',
        path: '/foo',
        baseVersion: 'bafy-base',
        genesis: 'bafy-genesis',
        generation: 123,
        changes: [{op: {case: 'setMetadata', value: {key: 'name', value: 'Foo'}}}],
      },
      signer,
    )
  })
})
