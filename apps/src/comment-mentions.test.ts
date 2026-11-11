import {describe, expect, test} from 'bun:test'
import {markdownBlockNodesToHMBlockNodes, parseMarkdown} from '@seed-hypermedia/client'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {
  MENTION_PLACEHOLDER,
  findPlainMentions,
  mentionMarkdown,
  plainMentionsError,
  prepareCommentMentions,
} from './comment-mentions'

const ARTIST = 'z6MkhT6BAwvqaJJe5sMXtUmFVRZv3Kpw2sBkSqGp6zxdcj8p'
const ION = 'z6MkpVa5nMUR5ZaUEyV1SE48KTNbwTuHRd83RwLgMKc4nGU3'

function blocksOf(markdown: string): HMBlockNode[] {
  return markdownBlockNodesToHMBlockNodes(parseMarkdown(markdown).tree)
}

function paragraph(blocks: HMBlockNode[], index = 0) {
  const block = blocks[index]!.block as unknown as {
    text: string
    annotations: Array<{type: string; starts: number[]; ends: number[]; link?: string; attributes?: unknown}>
  }
  return block
}

describe('prepareCommentMentions', () => {
  test('the resolved-markdown form [@Name](hm://uid/:profile) is an inline mention', () => {
    const prepared = prepareCommentMentions(blocksOf(`Thanks, [@Artist](hm://${ARTIST}/:profile). Two options please.`))
    const block = paragraph(prepared.blocks)
    expect(block.text).toBe(`Thanks, ${MENTION_PLACEHOLDER}. Two options please.`)
    expect(block.annotations).toEqual([
      {type: 'Embed', starts: [8], ends: [9], link: `hm://${ARTIST}/:profile`, attributes: {mentionKind: 'account'}},
    ])
    expect(prepared.mentionedAccounts).toEqual([ARTIST])
    expect(prepared.plainMentions).toEqual([])
  })

  test('the bare [@](hm://uid/:profile) form is a mention', () => {
    const prepared = prepareCommentMentions(blocksOf(`[@](hm://${ARTIST}/:profile) two options please`))
    const block = paragraph(prepared.blocks)
    expect(block.text).toBe(`${MENTION_PLACEHOLDER} two options please`)
    expect(block.annotations[0]!.type).toBe('Embed')
    expect(prepared.mentionedAccounts).toEqual([ARTIST])
  })

  test('an @-labelled link to the account root is a mention too', () => {
    const prepared = prepareCommentMentions(blocksOf(`[@Artist](hm://${ARTIST}) ping`))
    const block = paragraph(prepared.blocks)
    expect(block.text).toBe(`${MENTION_PLACEHOLDER} ping`)
    expect(block.annotations[0]!.type).toBe('Embed')
    expect(prepared.mentionedAccounts).toEqual([ARTIST])
  })

  test('a plain [Name](hm://uid/:profile) link in a comment is promoted to a mention', () => {
    const prepared = prepareCommentMentions(
      blocksOf(`Thanks, **[Artist](hm://${ARTIST}/:profile)** — and see [the notes](hm://${ION}/notes) too.`),
    )
    const block = paragraph(prepared.blocks)
    expect(block.text).toBe(`Thanks, ${MENTION_PLACEHOLDER} — and see the notes too.`)
    const embed = block.annotations.find((a) => a.type === 'Embed')!
    expect(embed).toEqual({
      type: 'Embed',
      starts: [8],
      ends: [9],
      link: `hm://${ARTIST}/:profile`,
      attributes: {mentionKind: 'account'},
    })
    // Bold that only covered the label is gone; the document link after it moved left with the text.
    expect(block.annotations.filter((a) => a.type === 'Bold')).toEqual([])
    const docLink = block.annotations.find((a) => a.type === 'Link')!
    expect(docLink.link).toBe(`hm://${ION}/notes`)
    expect(block.text.slice(docLink.starts[0]!, docLink.ends[0]!)).toBe('the notes')
    expect(prepared.mentionedAccounts).toEqual([ARTIST])
  })

  test('a link to the account root without @ stays a link (it is the home document)', () => {
    const prepared = prepareCommentMentions(blocksOf(`see [Ion's home](hm://${ION})`))
    expect(paragraph(prepared.blocks).annotations[0]!.type).toBe('Link')
    expect(prepared.mentionedAccounts).toEqual([])
  })

  test('a link to a comment is not a mention', () => {
    const prepared = prepareCommentMentions(blocksOf(`Thanks, [Artist](hm://${ARTIST}/z6JtcUvwTi3HCT).`))
    expect(paragraph(prepared.blocks).annotations[0]!.type).toBe('Link')
    expect(prepared.mentionedAccounts).toEqual([])
  })

  test('plain @Name text is reported, the exact failure from hyper.media', () => {
    const prepared = prepareCommentMentions(
      blocksOf("When I need to activate an agent, I'll use @Artist. Thanks @Eric!"),
    )
    expect(prepared.plainMentions).toEqual(['Artist', 'Eric'])
    expect(prepared.mentionedAccounts).toEqual([])
  })

  test('@ inside code spans, emails, and after a mention are not plain mentions', () => {
    const prepared = prepareCommentMentions(
      blocksOf(`Write \`@media\` rules; mail eric@example.com; [@Artist](hm://${ARTIST}/:profile) is mentioned.`),
    )
    expect(prepared.plainMentions).toEqual([])
    expect(prepared.mentionedAccounts).toEqual([ARTIST])
  })

  test('walks nested children and dedupes mentioned accounts', () => {
    const prepared = prepareCommentMentions(
      blocksOf(`[@Artist](hm://${ARTIST}/:profile)\n\n- first [@Artist](hm://${ARTIST})\n- second @Ion`),
    )
    expect(prepared.mentionedAccounts).toEqual([ARTIST])
    expect(prepared.plainMentions).toEqual(['Ion'])
  })
})

describe('findPlainMentions', () => {
  test('matches handles at word starts only', () => {
    expect(findPlainMentions('@a, (@b.c) and @d_e-f.', [])).toEqual(['a', 'b.c', 'd_e-f'])
    expect(findPlainMentions('foo@bar.com hm://x/@y a@@b', [])).toEqual([])
    expect(findPlainMentions('@', [])).toEqual([])
  })

  test('skips code ranges counted in code points', () => {
    const text = '😀 `@x` @y'
    // code points: 😀(0) space(1) `@x` → the Code annotation covers "@x" at [2,4); "@y" starts at 5
    expect(findPlainMentions(text, [{type: 'Code', starts: [2], ends: [4]}])).toEqual(['y'])
  })
})

describe('mentionMarkdown / plainMentionsError', () => {
  test('mentionMarkdown builds the ready-to-paste form', () => {
    expect(mentionMarkdown(ARTIST)).toBe(`[@](hm://${ARTIST}/:profile)`)
  })

  test('the refusal names the tokens and the working form', () => {
    const message = plainMentionsError(['Artist', 'Artist', 'Eric'])
    expect(message).toContain('@Artist, @Eric')
    expect(message).toContain('[@](hm://ACCOUNT_UID/:profile)')
    expect(message).toContain('allowPlainMentions')
  })
})
