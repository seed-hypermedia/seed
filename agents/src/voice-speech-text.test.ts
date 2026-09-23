import {describe, expect, test} from 'bun:test'
import {SpeechTextStream, stripMarkdownForSpeech} from './voice-speech-text'

describe('stripMarkdownForSpeech', () => {
  test('removes emphasis markers but keeps the words', () => {
    expect(stripMarkdownForSpeech('This is **bold**, __also bold__, *italic*, _italic_ and ~~struck~~.')).toBe(
      'This is bold, also bold, italic, italic and struck.',
    )
  })

  test('keeps underscores inside identifiers and asterisks used as operators', () => {
    expect(stripMarkdownForSpeech('call snake_case_name with 2 * 3')).toBe('call snake_case_name with 2 * 3')
  })

  test('removes inline code backticks and keeps the code text', () => {
    expect(stripMarkdownForSpeech('run `bun test` now')).toBe('run bun test now')
  })

  test('removes fenced code markers and keeps the code', () => {
    expect(stripMarkdownForSpeech('Example:\n```ts\nconst x = 1\n```\nDone.')).toBe('Example:\nconst x = 1\nDone.')
  })

  test('replaces mermaid fences with (diagram)', () => {
    expect(stripMarkdownForSpeech('Flow:\n```mermaid\ngraph TD\nA-->B\n```\nEnd.')).toBe('Flow:\n(diagram)\nEnd.')
  })

  test('drops heading and blockquote markers', () => {
    expect(stripMarkdownForSpeech('# Title\n## Sub\n> quoted\n>> nested')).toBe('Title\nSub\nquoted\nnested')
  })

  test('drops list bullets and numbers', () => {
    expect(stripMarkdownForSpeech('- one\n* two\n+ three\n1. four\n2) five\n- [ ] task\n- [x] done')).toBe(
      'one\ntwo\nthree\nfour\nfive\ntask\ndone',
    )
  })

  test('converts links to their label and images to their alt text', () => {
    expect(stripMarkdownForSpeech('See [the docs](https://example.com/x) and ![a cat](hm://z6Mk/cat.png).')).toBe(
      'See the docs and a cat.',
    )
  })

  test('replaces bare URLs with the word link', () => {
    expect(
      stripMarkdownForSpeech('Open hm://z6MkfzKM/agent-guide or https://hyper.media/docs?x=1 or <ipfs://bafy>.'),
    ).toBe('Open link or link or link.')
  })

  test('removes HTML comments and simple tags', () => {
    expect(stripMarkdownForSpeech('Hello <!-- hidden\nnote --> world<br>again <b>bold</b>')).toBe(
      'Hello world again bold',
    )
  })

  test('joins table rows with commas and drops the separator row', () => {
    expect(stripMarkdownForSpeech('| Name | Age |\n|---|---|\n| Ann | 30 |\n| Bob | 41 |')).toBe(
      'Name, Age\nAnn, 30\nBob, 41',
    )
  })

  test('drops horizontal rules and unescapes escaped punctuation', () => {
    expect(stripMarkdownForSpeech('above\n---\nbelow \\*not bold\\*')).toBe('above\nbelow *not bold*')
  })

  test('does not treat a mid-line dash as a bullet when not at line start', () => {
    expect(stripMarkdownForSpeech('- two', {atLineStart: false})).toBe('- two')
    expect(stripMarkdownForSpeech('- two', {atLineStart: true})).toBe('two')
  })

  test('collapses runs of blank lines', () => {
    expect(stripMarkdownForSpeech('a\n\n\n\nb')).toBe('a\n\nb')
  })
})

describe('SpeechTextStream', () => {
  function stream(deltas: string[]): {spoken: string[]; joined: string} {
    const s = new SpeechTextStream()
    const spoken = deltas.map((d) => s.push(d))
    spoken.push(s.flush())
    return {spoken, joined: spoken.join('')}
  }

  test('produces the same text as stripping the whole reply', () => {
    const reply =
      '# Summary\n\nThe **quick** brown fox [jumps](hm://z6Mk/fox) over `it`.\n\n- one\n- two\n\n' +
      '| a | b |\n|---|---|\n| 1 | 2 |\n\n```mermaid\ngraph TD\n```\n\nSee https://example.com/path now.'
    const deltas: string[] = []
    for (let i = 0; i < reply.length; i += 3) deltas.push(reply.slice(i, i + 3))
    expect(stream(deltas).joined).toBe(stripMarkdownForSpeech(reply))
  })

  test('holds back an emphasis marker split across deltas', () => {
    const {spoken} = stream(['This is *', '*bold*', '* text'])
    expect(spoken[0]).toBe('This is ')
    expect(spoken.join('')).toBe('This is bold text')
  })

  test('holds back a link until it closes', () => {
    const {spoken, joined} = stream(['Read [the', ' guide](hm://z6', 'Mk/guide) today'])
    expect(spoken[0]).toBe('Read ')
    expect(spoken[1]).toBe('')
    expect(joined).toBe('Read the guide today')
  })

  test('holds back a URL until whitespace follows it', () => {
    const {spoken, joined} = stream(['go to https://exa', 'mple.com/a', ' now'])
    expect(spoken[0]).toBe('go to ')
    expect(spoken[1]).toBe('')
    expect(joined).toBe('go to link now')
  })

  test('releases plain prose immediately', () => {
    const {spoken} = stream(['Hello there, ', 'how are you today?'])
    expect(spoken[0]).toBe('Hello there, ')
    expect(spoken[1]).toBe('how are you today?')
  })

  test('holds a fenced block until it closes and speaks (diagram) once', () => {
    const {spoken, joined} = stream(['Look:\n```mer', 'maid\ngraph TD\nA', '-->B\n```\nok'])
    expect(spoken[0]).toBe('Look:\n')
    expect(spoken[1]).toBe('')
    expect(joined).toBe('Look:\n(diagram)\nok')
  })

  test('flush releases an unterminated construct', () => {
    const {joined} = stream(['see [dangling'])
    expect(joined).toBe('see [dangling')
  })
})
