/**
 * Compile-level checks for the generated Onyx types (onyx-types.generated.ts).
 * The real assertions happen at typecheck time — `tsc --noEmit` fails if the
 * generator mismaps the dialect. The runtime expects only pin the values.
 */
import {describe, expect, it} from 'vitest'
import type {
  ExamplePollBlock,
  HMBlockImage,
  HMBlockQuery,
  HMChange,
  HMQuery,
  SeedCitation,
  SeedDiscoveryStatus,
  SeedResource,
} from '../src/onyx-types.generated'

describe('generated onyx types', () => {
  it('types a core block (extension narrows the base)', () => {
    const image: HMBlockImage = {
      id: 'b1',
      type: 'Image',
      link: 'ipfs://bafy123',
      attributes: {width: 320},
    }
    // @ts-expect-error link is required on an Image block
    const missingLink: HMBlockImage = {id: 'b2', type: 'Image'}
    // @ts-expect-error the type discriminator is pinned to 'Image'
    const wrongType: HMBlockImage = {id: 'b3', type: 'Video', link: 'ipfs://x'}
    expect(image.type).toBe('Image')
    expect([missingLink, wrongType]).toBeTruthy()
  })

  it('types the Query block and its embedded query', () => {
    const query: HMQuery = {
      includes: [{space: 'z6Mk123', mode: 'Children', path: 'docs'}],
      sort: [{term: 'UpdateTime', reverse: true}],
      limit: 10,
    }
    const block: HMBlockQuery = {
      id: 'q1',
      type: 'Query',
      attributes: {query, style: 'Table', banner: false},
    }
    // @ts-expect-error mode is a closed enum
    const badMode: HMQuery = {includes: [{space: 'z6Mk123', mode: 'Everything'}]}
    expect(block.attributes.query.includes).toHaveLength(1)
    expect(badMode).toBeTruthy()
  })

  it('types generics: Change<Block> applies the block parameter', () => {
    type PollChange = HMChange<ExamplePollBlock>
    const change: PollChange = {
      signer: new Uint8Array(),
      sig: new Uint8Array(),
      ts: 1,
      type: 'Change',
      body: {ops: [{type: 'ReplaceBlock', block: {id: 'p1', type: 'Poll', question: 'Tea?', options: ['yes']}}]},
    }
    expect(change.body?.ops?.[0]).toBeTruthy()
  })

  it('types the derived read models (seed-*)', () => {
    const status: SeedDiscoveryStatus = {state: 'found', version: 'bafyv1'}
    const resource: SeedResource = {
      type: 'not-found',
      id: {
        id: 'hm://z6Mk123/docs',
        uid: 'z6Mk123',
        path: ['docs'],
        version: null,
        blockRef: null,
        blockRange: null,
        hostname: null,
        scheme: null,
      },
    }
    if (resource.type === 'not-found') {
      expect(resource.id.uid).toBe('z6Mk123')
    }
    const citation: SeedCitation = {
      source: {type: 'd', id: resource.id},
      isExactVersion: false,
      targetFragment: null,
      targetId: resource.id,
    }
    // @ts-expect-error a resource union member can't carry a foreign payload
    const bad: SeedResource = {type: 'not-found', id: resource.id, message: 'nope'}
    expect([status, citation, bad]).toBeTruthy()
  })
})
