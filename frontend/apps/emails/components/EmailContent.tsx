import {MjmlButton, MjmlColumn, MjmlImage, MjmlSection, MjmlText} from '@faire/mjml-react'
import {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {createWebHMUrl, unpackHmId} from '@shm/shared'
import {DAEMON_FILE_URL} from '@shm/shared/constants'
import {formattedDateShort} from '@shm/shared/utils/date'
import React from 'react'
import {Notification} from '../notifier'
import {emailTheme} from './EmailLayout'

export function getDaemonFileUrl(ipfsUrl?: string) {
  if (ipfsUrl) {
    return `${DAEMON_FILE_URL}/${extractIpfsUrlCid(ipfsUrl)}`
  }
  return ''
}

export function extractIpfsUrlCid(cidOrIPFSUrl: string): string {
  const regex = /^ipfs:\/\/(.+)$/
  const match = cidOrIPFSUrl.match(regex)
  return match ? match[1]! : cidOrIPFSUrl
}

/** One notification inside a digest email: author row followed by the quoted content. */
export function EmailContent({notification}: {notification: Notification}) {
  const {authorName, authorAvatar, fallbackLetter, createdAt} = getNotificationMeta(notification)
  const avatarStyle: React.CSSProperties = {
    display: 'inline-block',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    verticalAlign: 'middle',
    marginRight: '8px',
  }

  return (
    <>
      <MjmlSection padding={`8px ${emailTheme.gutter} 0`}>
        <MjmlColumn>
          <MjmlText fontSize="14px" lineHeight="24px" color={emailTheme.heading} padding="0">
            {authorAvatar ? (
              <img src={authorAvatar} alt="" width={24} height={24} style={avatarStyle} />
            ) : (
              <span
                style={{
                  ...avatarStyle,
                  backgroundColor: emailTheme.primary,
                  color: '#ffffff',
                  textAlign: 'center',
                  fontSize: '12px',
                  fontWeight: 'bold',
                }}
              >
                {fallbackLetter}
              </span>
            )}
            <strong>{authorName}</strong>
            {createdAt ? <span style={{color: emailTheme.muted}}> · {createdAt}</span> : null}
          </MjmlText>
        </MjmlColumn>
      </MjmlSection>
      <NotificationContent notification={notification} />
    </>
  )
}

function assertNever(value: never): never {
  throw new Error(`Unhandled notification type: ${JSON.stringify(value)}`)
}

function NotificationContent({notification}: {notification: Notification}) {
  switch (notification.reason) {
    case 'site-doc-update':
      return (
        <NoteText>
          {notification.isNewDocument ? 'Created a new document' : 'Made a new change to the document'}
        </NoteText>
      )
    case 'mention':
      return notification.comment ? (
        <QuotedContent
          blocks={notification.comment.content}
          notifUrl={notification.url}
          resolvedNames={notification.resolvedNames}
        />
      ) : (
        <NoteText>Mentioned {notification.subjectAccountMeta?.name ?? 'you'} in the document</NoteText>
      )
    case 'reply':
    case 'site-new-discussion':
    case 'discussion':
    case 'user-comment':
      return (
        <QuotedContent
          blocks={notification.comment.content}
          notifUrl={notification.url}
          resolvedNames={notification.resolvedNames}
        />
      )
    default:
      return assertNever(notification)
  }
}

function NoteText({children}: {children: React.ReactNode}) {
  return (
    <MjmlSection padding={`8px ${emailTheme.gutter} 16px`}>
      <MjmlColumn>
        <MjmlText fontSize="16px" lineHeight="1.5" color={emailTheme.body} padding="0">
          {children}
        </MjmlText>
      </MjmlColumn>
    </MjmlSection>
  )
}

/** Wrapper for quoted comment/discussion content in the new email templates. */
export function QuotedContent({
  blocks,
  notifUrl = '',
  resolvedNames,
  variant = 'box',
}: {
  blocks: HMBlockNode[]
  notifUrl?: string
  resolvedNames?: Record<string, string>
  /** 'box' = gray background (comments/discussions), 'border' = left green border (mentions). */
  variant?: 'box' | 'border'
}) {
  if (variant === 'border') {
    return (
      <MjmlSection padding={`8px ${emailTheme.gutter} 16px`}>
        <MjmlColumn borderLeft={`3px solid ${emailTheme.primary}`} paddingLeft="16px">
          {renderBlocks(blocks, notifUrl, resolvedNames)}
        </MjmlColumn>
      </MjmlSection>
    )
  }

  return (
    <MjmlSection padding={`8px ${emailTheme.gutter} 16px`}>
      <MjmlColumn backgroundColor={emailTheme.quoteBackground} padding="8px 0">
        {renderBlocks(blocks, notifUrl, resolvedNames)}
      </MjmlColumn>
    </MjmlSection>
  )
}

/** Recursively render HMBlockNode[] to MJML elements. */
export function renderBlocks(blocks: HMBlockNode[], notifUrl: string, resolvedNames?: Record<string, string>) {
  return blocks.map((blockNode, index) => (
    <React.Fragment key={index}>
      {renderBlock(blockNode, notifUrl, resolvedNames)}
      {blockNode.children?.length ? renderBlocks(blockNode.children, notifUrl, resolvedNames) : null}
    </React.Fragment>
  ))
}

export function renderBlock(blockNode: HMBlockNode, notifUrl: string, resolvedNames?: Record<string, string>) {
  const block = blockNode.block as {
    type: string
    text?: string
    annotations?: unknown[]
    link?: string
    attributes?: Record<string, unknown>
  }
  const {type, text, annotations, link, attributes} = block

  const innerHtml = renderInlineTextWithAnnotations(text || '', annotations || [], resolvedNames)

  if (type === 'Paragraph') {
    return (
      <MjmlText align="left" paddingBottom="8px" fontSize="16px" lineHeight="1.5" color={emailTheme.heading}>
        <span dangerouslySetInnerHTML={{__html: innerHtml}} />
      </MjmlText>
    )
  }

  if (type === 'Heading') {
    return (
      <MjmlText align="left" paddingBottom="8px" fontSize="24px" fontWeight="bold">
        <span dangerouslySetInnerHTML={{__html: innerHtml}} />
      </MjmlText>
    )
  }

  if (type === 'Image') {
    const width = attributes?.width ?? 400
    let src: string | undefined = undefined
    if (link?.startsWith('ipfs://')) {
      const cid = extractIpfsUrlCid(link)
      src = `http://localhost:58001/ipfs/${cid}`
    } else {
      src = link
    }

    return (
      <>
        <MjmlImage src={src} alt={text || 'Image'} width={width as number} paddingBottom="8px" />
        {text && (
          <MjmlText fontSize="12px" color="#666" paddingBottom="12px" align="center">
            {text}
          </MjmlText>
        )}
      </>
    )
  }

  if (type === 'Video') {
    if (link?.includes('youtube.com') || link?.includes('youtu.be')) {
      return <BlockLink href={link}>Watch Video on YouTube</BlockLink>
    } else {
      return <BlockLink href={notifUrl}>Watch Video in the Comment</BlockLink>
    }
  }

  if (type === 'WebEmbed') {
    if (link?.includes('instagram.com')) {
      return <BlockLink href={link}>Open in Instagram</BlockLink>
    } else if (link?.includes('x.com')) {
      return <BlockLink href={link}>Open in X.com</BlockLink>
    }
  }

  if (type === 'Button') {
    const buttonAttrs = attributes as {fields?: {name?: {kind?: {value?: string}}}}
    return (
      <MjmlButton
        href={link}
        backgroundColor={emailTheme.primary}
        borderRadius="8px"
        fontSize="14px"
        innerPadding="10px 16px"
        align="left"
      >
        {buttonAttrs.fields?.name?.kind?.value || link}
      </MjmlButton>
    )
  }

  if (type === 'Math') {
    return (
      <MjmlText align="left" paddingBottom="8px" fontSize="14px" fontFamily="monospace" color="#888">
        {text}
      </MjmlText>
    )
  }

  if (type === 'Code') {
    return (
      <MjmlText
        align="left"
        paddingBottom="8px"
        fontSize="14px"
        fontFamily="monospace"
        color="#666"
        backgroundColor="#f2f2f2"
        padding="12px"
        // borderRadius="4px"
      >
        <code>{text}</code>
      </MjmlText>
    )
  }

  if (type === 'Embed') {
    return <BlockLink href={link?.startsWith('hm://') ? hmToWebUrl(link) : link}>Open embedded content</BlockLink>
  }

  return null
}

/** Link rendered in place of a block that cannot be shown inline in an email (embeds, videos, social posts). */
function BlockLink({href, children}: {href?: string; children: React.ReactNode}) {
  return (
    <MjmlText align="left" paddingBottom="8px" fontSize="16px" lineHeight="1.5">
      <a href={href} style={{color: emailTheme.primaryText, textDecoration: 'underline'}}>
        {children}
      </a>
    </MjmlText>
  )
}

function hmToWebUrl(href: string) {
  const unpacked = unpackHmId(href)
  return unpacked ? createWebHMUrl(unpacked.uid, {path: unpacked.path, hostname: unpacked.hostname ?? null}) : href
}

/** Render inline text with bold/italic/link/embed annotations to HTML string. */
export function renderInlineTextWithAnnotations(
  text: string,
  annotations: any[],
  resolvedNames?: Record<string, string>,
) {
  if (!annotations.length) return text

  let result = []
  let lastIndex = 0

  annotations.forEach((annotation, index) => {
    const start = annotation.starts[0]
    const end = annotation.ends[0]

    if (start > lastIndex) {
      result.push(text.slice(lastIndex, start))
    }

    let annotatedText = text.slice(start, end)
    if (annotation.type === 'Bold') {
      annotatedText = `<b>${annotatedText}</b>`
    } else if (annotation.type === 'Italic') {
      annotatedText = `<i>${annotatedText}</i>`
    } else if (annotation.type === 'Strike') {
      annotatedText = `<s>${annotatedText}</s>`
    } else if (annotation.type === 'Code') {
      annotatedText = `<code>${annotatedText}</code>`
    } else if (annotation.type === 'Link') {
      let href = annotation.link as string | undefined
      if (href?.startsWith('hm://')) href = hmToWebUrl(href)
      annotatedText = `<a href="${href}" style="color: ${emailTheme.primaryText};">${annotatedText}</a>`
    } else if (annotation.type === 'Embed') {
      const annotationLink = annotation.link as string | undefined
      const resolved = resolvedNames?.[annotationLink || ''] || annotationLink

      let href = annotationLink
      if (href?.startsWith('hm://')) href = hmToWebUrl(href)
      annotatedText = `<a href="${href}" style="color: ${emailTheme.primaryText};">${resolved}</a>`
    }

    result.push(annotatedText)
    lastIndex = end
  })

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex))
  }

  return result.join('')
}

function getNotificationMeta(notification: Notification) {
  const authorMeta = notification.authorMeta

  const authorName =
    authorMeta?.name ||
    ('comment' in notification && notification.comment
      ? notification.comment.author
      : 'authorAccountId' in notification
        ? notification.authorAccountId
        : 'Unknown')

  const authorAvatar = authorMeta?.icon ? getDaemonFileUrl(authorMeta.icon) : ''

  const createdAt = (() => {
    if (
      notification.reason === 'site-new-discussion' ||
      notification.reason === 'reply' ||
      notification.reason === 'discussion'
    ) {
      return formattedDateShort(notification.comment.createTime)
    }
    if (notification.reason === 'mention') {
      return formattedDateShort(notification.comment?.createTime)
    }
    return ''
  })()

  return {
    authorName,
    authorAvatar,
    fallbackLetter: authorName?.[0]?.toUpperCase?.() || '?',
    createdAt,
  }
}
