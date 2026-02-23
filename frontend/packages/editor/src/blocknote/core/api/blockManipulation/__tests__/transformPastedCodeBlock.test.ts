import {describe, expect, it} from 'vitest'
import {transformPastedCodeBlockHTML} from '../../../../../tiptap-extension-code-block/transformPastedCodeBlock'
import {getCodeClass, getCodeText} from './test-helpers-prosemirror'

describe('transformPastedCodeBlockHTML', () => {
  describe('Unchanged HTML', () => {
    // HTML that already has <pre> tags should be
    // returned unchanged to be parsed by prosemirror natively.
    it('returns unchanged when HTML already has <pre> tags', () => {
      const html = '<pre><code>const x = 1</code></pre>'
      expect(transformPastedCodeBlockHTML(html)).toBe(html)
    })

    // HTML with no <code> tags at all has nothing to rewrite.
    it('returns unchanged when no <code> tags exist', () => {
      const html = '<p>Hello world</p>'
      expect(transformPastedCodeBlockHTML(html)).toBe(html)
    })

    // A <code> tag without any recognizable attributes (no data-ch-lang,
    // no language-* class, no ch-code class) is treated as inline code.
    it('returns unchanged when <code> has no matching attributes', () => {
      const html = '<p>Use <code>npm install</code> to install</p>'
      expect(transformPastedCodeBlockHTML(html)).toBe(html)
    })
  })

  describe('Shiki-style (language-* class)', () => {
    // Shiki renders syntax-highlighted code as:
    //   <div><code class="language-typescript">
    //     <span style="color:blue">const</span> x = 1
    //   </code></div>
    it('rewrites div>code.language-* to pre>code', () => {
      const html = `<div><code class="language-typescript"><span>const</span> x = 1</code></div>`
      const result = transformPastedCodeBlockHTML(html)

      expect(result).toContain('<pre>')
      expect(result).not.toContain('<div>')
      expect(getCodeText(result)).toBe('const x = 1')
      expect(getCodeClass(result)).toBe('language-typescript')
    })

    // Shiki often wraps each line in a <span class="line"><span>token</span></span>.
    // extractText should recursively collect all text nodes and strip spans.
    it('strips nested highlighting spans and preserves text', () => {
      const html = `<div><code class="language-js"><span class="line"><span style="color:blue">function</span><span> foo() {</span></span><br><span class="line"><span>  return 1</span></span></code></div>`
      const result = transformPastedCodeBlockHTML(html)

      expect(result).toContain('<pre>')
      expect(result).not.toContain('<div>')
      expect(getCodeText(result)).toBe('function foo() {\n  return 1')
      expect(getCodeClass(result)).toBe('language-js')
    })
  })

  describe('CH.Code-style (data-ch-lang)', () => {
    // CH.Code (Code Hike) uses data-ch-lang attribute on <code>:
    //   <section><code data-ch-lang="python">
    //     <span>print</span>("hello")
    //   </code></section>
    //
    // The hook detects data-ch-lang, extracts language, and rewrites to <pre>.
    it('rewrites code[data-ch-lang] to pre>code', () => {
      const html = `<section><code data-ch-lang="python"><span>print</span>("hello")</code></section>`
      const result = transformPastedCodeBlockHTML(html)

      expect(result).toContain('<pre>')
      expect(result).not.toContain('<section>')
      expect(getCodeText(result)).toBe('print("hello")')
      expect(getCodeClass(result)).toBe('language-python')
    })
  })

  describe('ch-code class', () => {
    // Some CH.Code versions use class="ch-code-*" on the code element.
    it('rewrites code[class*="ch-code"] to pre>code', () => {
      const html = `<div><code class="ch-code-block">let y = 2</code></div>`
      const result = transformPastedCodeBlockHTML(html)

      expect(result).toContain('<pre>')
      expect(getCodeText(result)).toBe('let y = 2')
    })
  })

  describe('text extraction', () => {
    // <br> tags should be converted to newline characters.
    it('converts <br> to newlines', () => {
      const html = `<div><code class="language-py">line1<br>line2<br>line3</code></div>`
      const result = transformPastedCodeBlockHTML(html)

      expect(getCodeText(result)).toBe('line1\nline2\nline3')
    })

    // Block-level elements (<div>, <p>) inside code should produce newlines.
    it('adds newlines between block elements (div)', () => {
      const html = `<div><code class="language-go"><div>package main</div><div>func main() {}</div></code></div>`
      const result = transformPastedCodeBlockHTML(html)

      expect(getCodeText(result)).toBe('package main\nfunc main() {}')
    })

    // First block element should NOT get a leading newline.
    it('no leading newline for first block element', () => {
      const html = `<div><code class="language-rb"><div>puts "hello"</div></code></div>`
      const result = transformPastedCodeBlockHTML(html)

      expect(getCodeText(result)).toBe('puts "hello"')
    })
  })

  describe('container replacement', () => {
    // The hook walks UP from <code> to find the nearest block-level ancestor,
    // replaces it with <pre>, and stops at the first match.
    it('replaces nearest block-level ancestor with pre', () => {
      const html = `<article><div class="wrapper"><code class="language-rust">fn main() {}</code></div></article>`
      const result = transformPastedCodeBlockHTML(html)

      // The nearest block ancestor (<div>) is replaced, <article> stays
      expect(result).not.toContain('<div')
      expect(result).toContain('<article>')
      expect(result).toContain('<pre>')
      expect(getCodeText(result)).toBe('fn main() {}')
    })

    // When <code> has no block-level ancestor,
    // the <code> element itself gets replaced.
    it('replaces code element itself when no block ancestor', () => {
      const html = `<span><code class="language-c">int x;</code></span>`
      const result = transformPastedCodeBlockHTML(html)

      expect(result).toContain('<pre>')
      expect(getCodeText(result)).toBe('int x;')
    })
  })

  describe('language detection', () => {
    // data-ch-lang takes priority over class="language-*".
    it('prefers data-ch-lang over class', () => {
      const html = `<div><code data-ch-lang="python" class="language-javascript">x = 1</code></div>`
      const result = transformPastedCodeBlockHTML(html)

      expect(getCodeClass(result)).toBe('language-python')
    })

    // When no language is detected, the inner <code> should have no class.
    it('produces no class when no language detected', () => {
      const html = `<div><code class="ch-code-block">x = 1</code></div>`
      const result = transformPastedCodeBlockHTML(html)

      expect(getCodeClass(result)).toBe('')
    })
  })

  describe('multiple code blocks', () => {
    // When pasting HTML with multiple code blocks, all should be rewritten.
    it('rewrites all code blocks in the paste', () => {
      const html = `<div><code class="language-js">const a = 1</code></div><div><code class="language-py">x = 2</code></div>`
      const result = transformPastedCodeBlockHTML(html)

      const doc = new DOMParser().parseFromString(result, 'text/html')
      const pres = doc.querySelectorAll('pre')
      expect(pres).toHaveLength(2)
      expect(pres[0]!.textContent).toBe('const a = 1')
      expect(pres[1]!.textContent).toBe('x = 2')
    })
  })
})
