import {describe, expect, test} from 'bun:test'
import {getToolReferencedUrls} from './tool-registry'

describe('tool reference extraction', () => {
  test('includes the exact version of a newly created document', () => {
    expect(
      getToolReferencedUrls('write', {
        output: {
          type: 'hypermedia_write_result',
          command: 'document.create',
          id: 'hm://z6MkAgent/notes',
          version: 'bafy+new/version',
        },
      }),
    ).toEqual(['hm://z6MkAgent/notes?v=bafy%2Bnew%2Fversion'])
  })

  test('includes a new comment and its target document', () => {
    expect(
      getToolReferencedUrls('write', {
        output: {
          type: 'hypermedia_write_result',
          command: 'comment.create',
          commentUrl: 'hm://z6MkOwner/notes/:comments/z6MkAgent/01ABC',
          target: 'hm://z6MkOwner/notes',
          targetUrl: 'hm://z6MkOwner/notes',
          authorUrl: 'hm://z6MkAgent',
        },
      }),
    ).toEqual([
      'hm://z6MkOwner/notes/:comments/z6MkAgent/01ABC',
      'hm://z6MkOwner/notes',
      'hm://z6MkOwner/notes',
      'hm://z6MkAgent',
    ])
  })
})
