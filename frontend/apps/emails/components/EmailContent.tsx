import {
  MjmlButton,
  MjmlColumn,
  MjmlImage,
  MjmlRaw,
  MjmlSection,
  MjmlText,
} from '@faire/mjml-react'
import {BlockNode, createWebHMUrl, unpackHmId} from '@shm/shared'
import {DAEMON_FILE_URL} from '@shm/shared/constants'
import {format} from 'date-fns'
import React from 'react'
import {Notification} from '../notifier'

export function getDaemonFileUrl(ipfsUrl?: string) {
  if (ipfsUrl) {
    return `${DAEMON_FILE_URL}/${extractIpfsUrlCid(ipfsUrl)}`
  }
  return ''
}

export function extractIpfsUrlCid(cidOrIPFSUrl: string): string {
  const regex = /^ipfs:\/\/(.+)$/
  const match = cidOrIPFSUrl.match(regex)
  // @ts-ignore
  return match ? match[1] : cidOrIPFSUrl
}

export function EmailContent({notification}: {notification: Notification}) {
  const {authorName, authorAvatar, fallbackLetter, createdAt} =
    getNotificationMeta(notification)

  return (
    <>
      <MjmlSection backgroundColor="#f9f9f9" borderRadius="6px">
        <MjmlColumn width="10%" verticalAlign="top">
          {authorAvatar.length ? (
            // <MjmlImage
            //   src={authorAvatar}
            //   alt="Sender Avatar"
            //   width="28px"
            //   height="28px"
            //   borderRadius="50%"
            //   paddingBottom="4px"
            // />
            <MjmlRaw>
              <img
                src={authorAvatar}
                alt="Sender Avatar"
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  marginLeft: '23px',
                }}
              />
            </MjmlRaw>
          ) : (
            <MjmlRaw>
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: '#ccc',
                  textAlign: 'center',
                  lineHeight: '28px',
                  fontWeight: 'bold',
                  fontSize: '14px',
                  color: '#ffffff',
                  fontFamily: 'sans-serif',
                  marginLeft: '23px',
                }}
              >
                {fallbackLetter}
              </div>
            </MjmlRaw>
          )}
        </MjmlColumn>
        <MjmlColumn width="90%" verticalAlign="middle">
          <MjmlText
            fontSize="12px"
            fontWeight="bold"
            paddingBottom="4px"
            paddingRight="10px"
          >
            {authorName}
            {createdAt && (
              <span
                style={{color: '#888', fontWeight: 'normal', fontSize: '12px'}}
              >
                {' '}
                {createdAt}
              </span>
            )}
          </MjmlText>
        </MjmlColumn>
        {notification.reason === 'site-doc-update' ? (
          renderChange({
            targetDocName: notification.targetMeta?.name ?? 'Untitled Document',
            isNewDocument: notification.isNewDocument,
          })
        ) : notification.reason === 'mention' ? (
          <MjmlColumn width="100%" verticalAlign="middle">
            {notification.comment ? (
              renderMention({
                blocks: notification.comment.content.map(
                  (n) => new BlockNode(n),
                ),
                targetDocName:
                  notification.targetMeta?.name ?? 'Untitled Document',
                resolvedNames: notification.resolvedNames,
              })
            ) : (
              // Document mention
              <MjmlText fontSize="14px" padding="12px 25px">
                was mentioned in{' '}
                <span
                  style={{
                    backgroundColor: '#eee',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    display: 'inline-block',
                  }}
                >
                  {notification.targetMeta?.name ?? 'Untitled Document'}
                </span>
              </MjmlText>
            )}
          </MjmlColumn>
        ) : notification.reason === 'reply' ? (
          <MjmlColumn width="100%" verticalAlign="middle">
            <MjmlText fontSize="14px" color="#666" paddingBottom="8px">
              New reply:
            </MjmlText>
            <MjmlSection padding="0 0 8px 23px">
              <MjmlColumn border-left="1px solid #20C997">
                {renderBlocks(
                  notification.comment.content.map((n) => new BlockNode(n)),
                  notification.url,
                  notification.resolvedNames,
                )}
              </MjmlColumn>
            </MjmlSection>
          </MjmlColumn>
        ) : (
          // Default to comment
          <MjmlColumn width="100%" verticalAlign="middle">
            <MjmlText fontSize="14px" color="#666" paddingBottom="8px">
              Commented:
            </MjmlText>
            <MjmlSection padding="0 0 8px 23px">
              <MjmlColumn border-left="1px solid #20C997">
                {renderBlocks(
                  notification.comment.content.map((n) => new BlockNode(n)),
                  notification.url,
                  notification.resolvedNames,
                )}
              </MjmlColumn>
            </MjmlSection>
            <MjmlSection padding="0 0 16px 0">
              <MjmlColumn>
                <MjmlText fontSize="14px" color="#888">
                  on:{' '}
                  <span
                    style={{
                      backgroundColor: '#eee',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      display: 'inline-block',
                    }}
                  >
                    {notification.targetMeta?.name ?? 'Untitled Document'}
                  </span>
                </MjmlText>
              </MjmlColumn>
            </MjmlSection>
          </MjmlColumn>
        )}
      </MjmlSection>
    </>
  )
}

export function renderMention({
  blocks,
  targetDocName,
  resolvedNames,
}: {
  blocks: BlockNode[]
  targetDocName: string
  resolvedNames?: Record<string, string>
}) {
  return (
    <>
      <MjmlSection padding="0">
        <MjmlColumn>
          {/* "Mentioned:" label */}
          <MjmlText fontSize="14px" color="#666" paddingBottom="8px">
            Mentioned:
          </MjmlText>
        </MjmlColumn>
      </MjmlSection>

      {/* Comment block with green border on the left */}
      <MjmlSection padding="0 0 8px 23px">
        <MjmlColumn border-left="1px solid #20C997">
          {renderBlocks(blocks, '', resolvedNames)}
        </MjmlColumn>
      </MjmlSection>

      {/* Target document */}
      <MjmlSection padding="0 0 16px 0">
        <MjmlColumn>
          <MjmlText fontSize="14px" color="#888">
            on:{' '}
            <span
              style={{
                backgroundColor: '#eee',
                borderRadius: '4px',
                padding: '2px 6px',
                display: 'inline-block',
              }}
            >
              {targetDocName}
            </span>
          </MjmlText>
        </MjmlColumn>
      </MjmlSection>
    </>
  )
}

function renderChange({
  targetDocName,
  isNewDocument,
}: {
  targetDocName: string
  isNewDocument: boolean
}) {
  return (
    <>
      <MjmlSection padding="0" textAlign="left">
        <MjmlColumn>
          <MjmlText fontSize="16px" padding="12px 25px">
            {isNewDocument
              ? 'has created a new document:'
              : 'has made a new change to document:'}
          </MjmlText>
          <MjmlText fontSize="14px">
            <span
              style={{
                backgroundColor: '#eee',
                borderRadius: '4px',
                padding: '4px 8px',
                display: 'inline-block',
              }}
            >
              {targetDocName}
            </span>
          </MjmlText>
        </MjmlColumn>
      </MjmlSection>
    </>
  )
}

function renderBlocks(
  blocks: BlockNode[],
  notifUrl: string,
  resolvedNames?: Record<string, string>,
) {
  return blocks.map((blockNode, index) => (
    <React.Fragment key={index}>
      {renderBlock(blockNode, notifUrl, resolvedNames)}
      {blockNode.children?.length
        ? renderBlocks(blockNode.children, notifUrl, resolvedNames)
        : null}
    </React.Fragment>
  ))
}

function renderBlock(
  blockNode: BlockNode,
  notifUrl: string,
  resolvedNames?: Record<string, string>,
) {
  // @ts-ignore
  // @ts-ignore
  // @ts-ignore
  // @ts-ignore
  // @ts-ignore
  const {type, text, annotations, link, attributes} = blockNode.block

  const innerHtml = renderInlineTextWithAnnotations(
    text,
    annotations,
    resolvedNames,
  )

  if (type === 'Paragraph') {
    return (
      <MjmlText align="left" paddingBottom="8px" fontSize="14px">
        <span dangerouslySetInnerHTML={{__html: innerHtml}} />
      </MjmlText>
    )
  }

  if (type === 'Heading') {
    return (
      <MjmlText
        align="left"
        paddingBottom="8px"
        fontSize="24px"
        fontWeight="bold"
      >
        <span dangerouslySetInnerHTML={{__html: innerHtml}} />
      </MjmlText>
    )
  }

  if (type === 'Image') {
    const width = attributes?.fields?.width?.kind?.value ?? 400
    let src: string | undefined = undefined
    if (link?.startsWith('ipfs://')) {
      const cid = extractIpfsUrlCid(link)
      src = `http://localhost:58001/ipfs/${cid}`
    } else {
      src = link
    }

    return (
      <>
        <MjmlImage
          src={src}
          alt={text || 'Image'}
          // @ts-ignore
          width={width}
          paddingBottom="8px"
        />
        {text && (
          <MjmlText
            fontSize="12px"
            color="#666"
            paddingBottom="12px"
            align="center"
          >
            {text}
          </MjmlText>
        )}
      </>
    )
  }

  if (type === 'Video') {
    if (link?.includes('youtube.com') || link?.includes('youtu.be')) {
      return (
        <MjmlButton
          href={link}
          backgroundColor="#FF0000"
          fontSize="14px"
          align="left"
        >
          Watch Video on YouTube
        </MjmlButton>
      )
    } else {
      return (
        <MjmlButton
          href={notifUrl}
          backgroundColor="#068f7b"
          fontSize="14px"
          align="left"
        >
          Watch Video in the Comment
        </MjmlButton>
      )
    }
  }

  if (type === 'WebEmbed') {
    if (link?.includes('instagram.com')) {
      return (
        <MjmlButton
          href={link}
          backgroundColor="#346DB7"
          fontSize="14px"
          align="left"
        >
          Open in Instagram
        </MjmlButton>
      )
    } else if (link.includes('x.com')) {
      return (
        <MjmlButton
          href={link}
          backgroundColor="#346DB7"
          fontSize="14px"
          align="left"
        >
          Open in X.com
        </MjmlButton>
      )
    }
  }

  if (type === 'Button') {
    return (
      <MjmlButton
        href={link}
        backgroundColor="#068f7b"
        fontSize="14px"
        align="left"
      >
        {/* @ts-ignore */}
        {attributes.fields?.name?.kind?.value || link}
      </MjmlButton>
    )
  }

  if (type === 'Math') {
    return (
      <MjmlText
        align="left"
        paddingBottom="8px"
        fontSize="14px"
        fontFamily="monospace"
        color="#888"
      >
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
    return (
      <MjmlButton
        href={link}
        backgroundColor="#346DB7"
        fontSize="14px"
        align="left"
      >
        Open Embed
      </MjmlButton>
    )
  }

  return null
}

function renderInlineTextWithAnnotations(
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
      // @ts-ignore
      // @ts-ignore
      // @ts-ignore
      annotatedText = `<code>${annotatedText}</code>`
    } else if (annotation.type === 'Link') {
      let href = annotation.link
      if (href?.startsWith('hm://')) {
        // @ts-ignore
        const unpacked = unpackHmId(href)
        // @ts-ignore
        href = createWebHMUrl(unpacked.uid, {
          // @ts-ignore
          path: unpacked.path,
          // @ts-ignore
          hostname: unpacked.hostname ?? null,
        })
      }
      annotatedText = `<a href="${href}" style="color: #346DB7;">${annotatedText}</a>`
    } else if (annotation.type === 'Embed') {
      const resolved = resolvedNames?.[annotation.link] || annotation.link

      // @ts-ignore
      // @ts-ignore
      // @ts-ignore
      let href = annotation.link
      // @ts-ignore
      // @ts-ignore
      // @ts-ignore
      if (href?.startsWith('hm://')) {
        // @ts-ignore
        const unpacked = unpackHmId(href)
        // @ts-ignore
        href = createWebHMUrl(unpacked.uid, {
          // @ts-ignore
          path: unpacked.path,
          // @ts-ignore
          hostname: unpacked.hostname ?? null,
        })
      }
      annotatedText = `<a href="${href}" style="color: #008060;">@${resolved}</a>`
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
      notification.reason === 'reply'
    ) {
      return notification.comment.createTime?.seconds
        ? format(
            new Date(Number(notification.comment.createTime.seconds) * 1000),
            'MMM d',
          )
        : ''
    }
    if (notification.reason === 'mention') {
      return notification.comment?.createTime?.seconds
        ? format(
            new Date(Number(notification.comment.createTime.seconds) * 1000),
            'MMM d',
          )
        : ''
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
