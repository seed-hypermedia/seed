import {describe, expect, test} from 'bun:test'
import {getToolReferencedUrls, seedVerbRegistry} from './tool-registry'
import {writeGuideRegistry} from './write-guides'

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

describe('write contract', () => {
  test('indexes every detailed resource guide without loading action schemas up front', () => {
    const description = seedVerbRegistry.write.description
    for (const resource of Object.keys(writeGuideRegistry)) {
      expect(description).toContain(`~/tools/write/${resource}`)
    }
    expect(description).toContain('grant WRITER or AGENT access')
    expect(description).not.toContain('capability.grant')
    expect(writeGuideRegistry.capabilities.markdown).toContain('capability.grant')
    expect(writeGuideRegistry.contacts.markdown).toContain('contact.create')
    expect(writeGuideRegistry.profiles.markdown).toContain('profile.update')
    expect(writeGuideRegistry.drafts.markdown).toContain('draft.create')
  })
})
