import {afterEach, describe, expect, test} from 'bun:test'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {configureDocsSpace, resolveDocsLinks, resolveDocsUrl} from './docs-space'

const ACCOUNT = 'z6MkoAVbUvhqBBkJ8CU9aDhn13UUu4UePixQdPFYumn5gsW3'
const OTHER = 'z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj'
const AGENT_GUIDE_URL = 'hm://hyper.media/agent/guide'

afterEach(() => configureDocsSpace({}))

describe('docs space', () => {
  test('leaves hm://hyper.media alone when no account is configured', () => {
    configureDocsSpace({})
    expect(resolveDocsUrl('hm://hyper.media/agent/guide')).toBe('hm://hyper.media/agent/guide')
  })

  test('rewrites the authority to the configured account', () => {
    configureDocsSpace({account: ACCOUNT})
    expect(resolveDocsUrl('hm://hyper.media')).toBe(`hm://${ACCOUNT}`)
    expect(resolveDocsUrl('hm://hyper.media/protocol/urls#blk')).toBe(`hm://${ACCOUNT}/protocol/urls#blk`)
    expect(resolveDocsUrl('hm://hyper.media.evil/x')).toBe('hm://hyper.media.evil/x')
    expect(resolveDocsUrl(`hm://${OTHER}/x`)).toBe(`hm://${OTHER}/x`)
  })

  test('reads the account file on every use', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docs-space-'))
    try {
      const file = join(dir, 'account')
      configureDocsSpace({accountFile: file})
      expect(resolveDocsUrl(AGENT_GUIDE_URL)).toBe(AGENT_GUIDE_URL)
      writeFileSync(file, `${ACCOUNT}\n`)
      expect(resolveDocsUrl(AGENT_GUIDE_URL)).toBe(`hm://${ACCOUNT}/agent/guide`)
      writeFileSync(file, `${OTHER}\n`)
      expect(resolveDocsUrl(AGENT_GUIDE_URL)).toBe(`hm://${OTHER}/agent/guide`)
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  test('the account flag wins over the file', () => {
    configureDocsSpace({account: OTHER, accountFile: '/nonexistent'})
    expect(resolveDocsUrl(AGENT_GUIDE_URL)).toBe(`hm://${OTHER}/agent/guide`)
  })

  test('resolves nested embed links in prompt blocks', () => {
    configureDocsSpace({account: ACCOUNT})
    const blocks = [
      {block: {id: 'a', type: 'Embed', link: AGENT_GUIDE_URL}},
      {
        block: {id: 'b', type: 'Paragraph', text: 'x'},
        children: [{block: {id: 'c', type: 'Embed', link: 'hm://hyper.media/protocol/urls'}}],
      },
    ]
    const out = resolveDocsLinks(blocks)
    expect(out[0]!.block.link).toBe(`hm://${ACCOUNT}/agent/guide`)
    expect(out[1]!.children![0]!.block.link).toBe(`hm://${ACCOUNT}/protocol/urls`)
    expect(blocks[0]!.block.link).toBe(AGENT_GUIDE_URL)
  })
})
