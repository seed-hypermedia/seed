/**
 * Rewrite custom code-block HTML (e.g. CH.Code, Shiki) into standard <pre>
 * so ProseMirror's DOMParser can recognise them as code blocks.
 *
 * Custom code renderers output syntax-highlighted code as nested <span> elements
 * inside <code> tags, often wrapped in <div>/<section> containers instead of <pre>.
 * ProseMirror only parses <pre> as a code block, so this function rewrites the HTML.
 */
export function transformPastedCodeBlockHTML(html: string): string {
  // Skip if already has <pre> tags — standard code blocks work fine
  if (/<pre\b/i.test(html)) return html

  // Skip if no <code> tags at all
  if (!/<code\b/i.test(html)) return html

  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Find <code> elements that look like code blocks (not inline code)
  const codeEls = Array.from(
    doc.querySelectorAll('code[data-ch-lang], code[class*="language-"], code[class*="ch-code"]'),
  )
  for (let i = 0; i < codeEls.length; i++) {
    const code = codeEls[i]!
    // Get the language from data attributes or class
    const lang = code.getAttribute('data-ch-lang') || code.className.match(/language-(\w+)/)?.[1] || ''

    // Extract text preserving line breaks from block elements/br tags
    const extractText = (el: Element): string => {
      const parts: string[] = []
      const blockTags = /^(div|p|br|li|tr)$/i
      for (let c = 0; c < el.childNodes.length; c++) {
        const child = el.childNodes[c]!
        if (child.nodeType === 3) {
          // Text node
          parts.push(child.textContent || '')
        } else if (child.nodeType === 1) {
          const childEl = child as Element
          const tag = childEl.tagName
          if (tag === 'BR') {
            parts.push('\n')
          } else {
            const isBlock = blockTags.test(tag)
            if (isBlock && parts.length > 0) {
              // Add newline before block elements (except first)
              const last = parts[parts.length - 1]
              if (last && !last.endsWith('\n')) parts.push('\n')
            }
            parts.push(extractText(childEl))
          }
        }
      }
      return parts.join('')
    }
    const text = extractText(code)

    // Create a <pre> element to replace the code block container
    const pre = doc.createElement('pre')
    const innerCode = doc.createElement('code')
    if (lang) innerCode.setAttribute('class', `language-${lang}`)
    innerCode.textContent = text
    pre.appendChild(innerCode)

    // Replace the closest block-level ancestor that wraps this code
    // (could be a div, section, etc.)
    let target: Element = code as Element
    let parent: Element | null = code.parentElement
    while (parent && parent !== doc.body) {
      const isBlock =
        (parent as HTMLElement).style?.whiteSpace === 'pre' ||
        (parent as HTMLElement).style?.display === 'block' ||
        /^(div|section|article|figure|aside)$/i.test(parent.tagName)
      if (isBlock && parent.parentElement) {
        target = parent
        break
      }
      parent = parent.parentElement
    }

    target.replaceWith(pre)
  }

  // Only return modified HTML if we actually made changes
  if (codeEls.length > 0) {
    return doc.body.innerHTML
  }

  return html
}
