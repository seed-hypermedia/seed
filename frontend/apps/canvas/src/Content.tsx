import {Fragment, type ReactNode} from 'react'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {ArrowUpRight, FileText, Link2} from 'lucide-react'
import {webUrl} from './graph'

/** Allows safe navigation and public Seed media without injecting remote HTML. */
export function safeUrl(value: string, origin: string): string | undefined {
  if (value.startsWith('ipfs://')) return `${origin}/ipfs/${value.slice(7)}`
  if (value.startsWith('hm://')) return webUrl(value)
  try {
    const url = new URL(value, origin)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}

function InlineText({block, origin}: {block: HMBlockNode['block']; origin: string}) {
  const text = 'text' in block && typeof block.text === 'string' ? block.text : ''
  const chars = Array.from(text)
  const annotations = 'annotations' in block && Array.isArray(block.annotations) ? block.annotations : []
  const cuts = new Set([0, chars.length])
  for (const annotation of annotations) {
    annotation.starts.forEach((n) => cuts.add(Math.max(0, Math.min(chars.length, n))))
    annotation.ends.forEach((n) => cuts.add(Math.max(0, Math.min(chars.length, n))))
  }
  const positions = [...cuts].sort((a, b) => a - b)
  return (
    <>
      {positions.slice(0, -1).map((start, i) => {
        const end = positions[i + 1]
        let result: ReactNode = chars.slice(start, end).join('')
        for (const annotation of annotations) {
          if (!annotation.starts.some((s, j) => s <= start && annotation.ends[j] >= end)) continue
          if (annotation.type === 'Bold') result = <strong>{result}</strong>
          if (annotation.type === 'Italic') result = <em>{result}</em>
          if (annotation.type === 'Strike') result = <s>{result}</s>
          if (annotation.type === 'Underline') result = <u>{result}</u>
          if (annotation.type === 'Code') result = <code>{result}</code>
          if (annotation.type === 'Link' || annotation.type === 'Embed') {
            const href = annotation.link ? safeUrl(annotation.link, origin) : undefined
            if (href)
              result = (
                <a href={href} target="_blank" rel="noreferrer">
                  {annotation.type === 'Embed' ? 'Linked reference ↗' : result}
                </a>
              )
          }
        }
        return <Fragment key={start}>{result}</Fragment>
      })}
    </>
  )
}

/** Renders Seed block content with native text selection, links, and lazy media. */
export function Content({content, origin}: {content: HMBlockNode[]; origin: string}) {
  return (
    <div className="document-content">
      {content.map((node) => {
        const block = node.block
        const type = block.type
        const link = 'link' in block && typeof block.link === 'string' ? block.link : ''
        const href = link ? safeUrl(link, origin) : undefined
        const attributes = 'attributes' in block ? (block.attributes as Record<string, unknown> | undefined) : undefined
        const inline = <InlineText block={block} origin={origin} />
        let body: ReactNode
        if (type === 'Heading') body = <h3>{inline}</h3>
        else if (type === 'Code' || type === 'Math') body = <pre>{'text' in block ? String(block.text || '') : ''}</pre>
        else if (type === 'Image' && href)
          body = (
            <figure>
              <img src={href} alt={'text' in block ? String(block.text || '') : ''} loading="lazy" />
              <figcaption>{inline}</figcaption>
            </figure>
          )
        else if (type === 'Video' && href && link.startsWith('ipfs://'))
          body = <video src={href} controls preload="none" />
        else if (type === 'Embed' || type === 'WebEmbed' || type === 'Button' || type === 'File' || type === 'Video')
          body = href ? (
            <a className="content-reference" href={href} target="_blank" rel="noreferrer">
              <Link2 size={14} />
              <span>
                {'text' in block && block.text
                  ? String(block.text)
                  : type === 'Embed'
                    ? 'Open linked document'
                    : 'Open attachment'}
              </span>
              <ArrowUpRight size={14} />
            </a>
          ) : (
            <p>{inline}</p>
          )
        else if (type === 'Query')
          body = (
            <div className="content-note">
              <FileText size={15} />
              Live collection · open the source to view its results
            </div>
          )
        else if (type === 'Table' || type === 'TableRow' || type === 'TableColumn') body = null
        else body = <p>{inline}</p>
        const children = node.children?.length ? <Content content={node.children} origin={origin} /> : null
        return (
          <div
            key={block.id}
            data-block-id={block.id}
            className={`content-block block-${type.toLowerCase()} ${
              attributes?.childrenType === 'Group' ? 'block-group' : ''
            }`}
          >
            {body}
            {attributes?.childrenType === 'Unordered' || attributes?.childrenType === 'Ordered' ? (
              <div className="list-children">{children}</div>
            ) : (
              children
            )}
          </div>
        )
      })}
    </div>
  )
}
