/**
 * The markdown parser runs on every streamed delta of every agent reply, so its behaviour on
 * *incomplete* input matters as much as its behaviour on well-formed input: mid-stream the source
 * routinely ends inside a fence or an unclosed `**`, and the reader must see stable text rather
 * than a block that flickers in and out.
 */

import {parseMarkdownBlocks, parseMarkdownInline} from '../Markdown'

describe('parseMarkdownBlocks', () => {
  it('separates paragraphs on blank lines', () => {
    const blocks = parseMarkdownBlocks('First para\nstill first\n\nSecond para')
    expect(blocks).toEqual([
      {kind: 'paragraph', text: 'First para\nstill first'},
      {kind: 'paragraph', text: 'Second para'},
    ])
  })

  it('reads headings by level', () => {
    expect(parseMarkdownBlocks('### Deploy steps')).toEqual([{kind: 'heading', level: 3, text: 'Deploy steps'}])
  })

  it('reads ordered and unordered list items, keeping nesting depth', () => {
    const blocks = parseMarkdownBlocks('- top\n  - nested\n1. first')
    expect(blocks).toEqual([
      {kind: 'listItem', text: 'top', ordered: false, marker: '•', depth: 0},
      {kind: 'listItem', text: 'nested', ordered: false, marker: '•', depth: 1},
      {kind: 'listItem', text: 'first', ordered: true, marker: '1.', depth: 0},
    ])
  })

  it('reads a fenced code block with its language', () => {
    const blocks = parseMarkdownBlocks('```ts\nconst x = 1\n```')
    expect(blocks).toEqual([{kind: 'code', text: 'const x = 1', language: 'ts'}])
  })

  it('renders an unterminated fence as the code that has arrived so far', () => {
    // The normal mid-stream state. Waiting for the closing fence would blank the block.
    const blocks = parseMarkdownBlocks('Here you go:\n```python\nprint("hi")')
    expect(blocks).toEqual([
      {kind: 'paragraph', text: 'Here you go:'},
      {kind: 'code', text: 'print("hi")', language: 'python'},
    ])
  })

  it('keeps markdown syntax inside a fence literal', () => {
    const blocks = parseMarkdownBlocks('```\n# not a heading\n- not a list\n```')
    expect(blocks).toEqual([{kind: 'code', text: '# not a heading\n- not a list', language: undefined}])
  })

  it('reads block quotes and horizontal rules', () => {
    expect(parseMarkdownBlocks('> quoted\n\n---')).toEqual([{kind: 'quote', text: 'quoted'}, {kind: 'rule'}])
  })

  it('returns nothing for empty or whitespace-only source', () => {
    expect(parseMarkdownBlocks('')).toEqual([])
    expect(parseMarkdownBlocks('\n\n  \n')).toEqual([])
  })
})

describe('parseMarkdownInline', () => {
  it('reads bold, italic, and code spans', () => {
    expect(parseMarkdownInline('a **b** c *d* e `f`')).toEqual([
      {kind: 'text', text: 'a '},
      {kind: 'strong', text: 'b'},
      {kind: 'text', text: ' c '},
      {kind: 'em', text: 'd'},
      {kind: 'text', text: ' e '},
      {kind: 'code', text: 'f'},
    ])
  })

  it('reads links', () => {
    expect(parseMarkdownInline('see [the doc](hm://abc/def)')).toEqual([
      {kind: 'text', text: 'see '},
      {kind: 'link', text: 'the doc', href: 'hm://abc/def'},
    ])
  })

  it('keeps emphasis markers inside a code span literal', () => {
    // Otherwise `**kwargs` in a code span would render as bold "kwargs" and lose the asterisks.
    expect(parseMarkdownInline('`**kwargs`')).toEqual([{kind: 'code', text: '**kwargs'}])
  })

  it('leaves an unterminated marker as literal text', () => {
    // Half-streamed bold. It must not swallow the rest of the line.
    expect(parseMarkdownInline('this is **half')).toEqual([{kind: 'text', text: 'this is **half'}])
  })

  it('does not treat underscores inside a word as emphasis', () => {
    // CommonMark's intraword rule. Agent prose names tools and files constantly, and
    // "read *agent* memory" would be both wrong and unreadable.
    expect(parseMarkdownInline('call read_agent_memory now')).toEqual([
      {kind: 'text', text: 'call read_agent_memory now'},
    ])
    expect(parseMarkdownInline('see ~/memory/notes_2026_08.md')).toEqual([
      {kind: 'text', text: 'see ~/memory/notes_2026_08.md'},
    ])
  })

  it('still reads underscore emphasis at word boundaries', () => {
    expect(parseMarkdownInline('this is _really_ important')).toEqual([
      {kind: 'text', text: 'this is '},
      {kind: 'em', text: 'really'},
      {kind: 'text', text: ' important'},
    ])
    expect(parseMarkdownInline('__bold__ start')).toEqual([
      {kind: 'strong', text: 'bold'},
      {kind: 'text', text: ' start'},
    ])
  })
})
