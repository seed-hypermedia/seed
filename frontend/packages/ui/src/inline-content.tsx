import {HMBlock} from '@shm/shared/hm-types'
import {HMInlineContent} from '@shm/shared/index'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useCallback} from 'react'
import {useDocContentContext} from './document-content-context'
import {cn} from './utils'

// Local reimplementation of useRouteLinkHref to work with standard HTML props
function useRouteLinkHref(href: string) {
  // This is a simplified version - you can expand this based on your routing needs
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (href.startsWith('hm://')) {
        e.preventDefault()
        // Handle hypermedia navigation - you'll need to implement this based on your routing
        console.log('Navigate to hypermedia link:', href)
      }
      // For regular links, let the default behavior handle it
    },
    [href],
  )

  const isExternal = !href.startsWith('hm://')

  return {
    href,
    onClick: handleClick,
    target: isExternal ? '_blank' : undefined,
    rel: isExternal ? 'noopener noreferrer' : undefined,
  }
}

// Helper function to generate text styling classes
function getTextStyles(
  styles: any,
  linkType: 'basic' | 'hypermedia' | null,
): string {
  return cn(
    styles.bold && 'font-bold',
    styles.italic && 'italic',
    styles.underline && 'underline',
    styles.strike && 'line-through',
    linkType === 'basic' && 'text-blue-600 hover:text-blue-800',
    linkType === 'hypermedia' && 'text-(--brand5) hover:text-brand-700',
  )
}

// Move renderInlineContent outside component for better performance
function renderInlineContent(
  content: HMInlineContent,
  index: number,
  inline: HMInlineContent[],
  linkType: 'basic' | 'hypermedia' | null,
  fontSize: number | undefined,
  InlineEmbed: React.FC<any>,
  onHoverIn: ((id: any) => void) | undefined,
  onHoverOut: ((id: any) => void) | undefined,
): React.ReactNode {
  if (content.type === 'text') {
    const {text, styles} = content

    // Handle line breaks - split text by newlines and render <br /> elements
    let children: React.ReactNode = text
    const textLines = text.split('\n')

    // Check if this is the last inline content and if it has more than one line
    const hasLineBreaks = inline.length === index + 1 && textLines.length > 1
    if (hasLineBreaks) {
      children = textLines.map(
        (line: string, i: number, arr: Array<string>) => {
          if (arr.length === i + 1) {
            return line
          } else {
            return (
              <>
                {line}
                <br />
              </>
            )
          }
        },
      )
    }

    // Handle code styling with proper <code> element
    if (styles.code) {
      children = (
        <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm">
          {children}
        </code>
      )
    }

    // Handle range highlighting
    if (styles.range) {
      return (
        <mark
          key={index}
          className={cn(
            'bg-yellow-200 dark:bg-yellow-800',
            styles.code ? '' : getTextStyles(styles, linkType),
          )}
        >
          {children}
        </mark>
      )
    }

    // Check if we need any styling that requires a wrapper
    const needsWrapper =
      styles.bold ||
      styles.italic ||
      styles.underline ||
      styles.strike ||
      linkType === 'basic' ||
      linkType === 'hypermedia' ||
      styles.code ||
      hasLineBreaks

    if (!needsWrapper) {
      // Return plain text without any wrapper
      return children
    }

    // Build Tailwind classes based on styles (only for non-code styles)
    const styleClasses = styles.code ? '' : getTextStyles(styles, linkType)

    return (
      <span
        key={index}
        {...(styleClasses && styleClasses.trim() && {className: styleClasses})}
      >
        {children}
      </span>
    )
  }

  if (content.type === 'link') {
    const isHmScheme = content.href.startsWith('hm://')
    const linkProps = useRouteLinkHref(content.href)

    return (
      <a
        key={index}
        {...linkProps}
        className={cn(
          'hover:underline',
          isHmScheme
            ? 'hm-link text-(--brand5) hover:text-brand-700'
            : 'link text-blue-600 hover:text-blue-800',
        )}
        onMouseEnter={() => {
          if (isHmScheme) {
            const parsedId = unpackHmId(content.href)
            if (parsedId) onHoverIn?.(parsedId)
          }
        }}
        onMouseLeave={() => {
          if (isHmScheme) {
            const parsedId = unpackHmId(content.href)
            if (parsedId) onHoverOut?.(parsedId)
          }
        }}
      >
        <InlineContentView
          inline={content.content}
          linkType={isHmScheme ? 'hypermedia' : 'basic'}
          fontSize={fontSize}
        />
      </a>
    )
  }

  if (content.type === 'inline-embed') {
    // Parse the link to get the ID components needed for InlineEmbed
    const parsedId = unpackHmId(content.link)
    if (!parsedId) {
      console.error('Failed to parse inline embed link:', content.link)
      return (
        <span key={index} className="text-red-500">
          Invalid embed
        </span>
      )
    }

    // Create a dummy block for BlockContentProps that matches HMBlock type
    const dummyBlock: HMBlock = {
      id: `inline-embed-${index}`,
      type: 'Embed',
      text: '',
      link: content.link,
      annotations: [],
      attributes: {
        childrenType: 'Group',
      },
      revision: '',
    }

    return (
      <InlineEmbed
        key={index}
        {...parsedId}
        block={dummyBlock}
        parentBlockId={null}
        depth={1}
        onHoverIn={onHoverIn}
        onHoverOut={onHoverOut}
      />
    )
  }

  return null
}

export function InlineContentView({
  inline,
  linkType = null,
  fontSize,
  className,
  ...props
}: {
  inline: HMInlineContent[]
  linkType?: 'basic' | 'hypermedia' | null
  fontSize?: number
  className?: string
}) {
  const {entityComponents, onHoverIn, onHoverOut, textUnit} =
    useDocContentContext()
  const InlineEmbed = entityComponents.Inline
  const fSize = fontSize || textUnit

  // Primary inline styles (more reliable than arbitrary Tailwind classes)
  const inlineStyles = {
    '--base-font-size': `${fSize}px`,
    fontSize: `${fSize}px`,
    lineHeight: `${fSize * 1.5}px`,
    whiteSpace: 'pre-wrap' as const,
  } as React.CSSProperties

  const baseClasses = cn(
    'whitespace-pre-wrap',
    'inline-content-responsive',
    className,
  )

  return (
    <span
      {...(baseClasses && baseClasses.trim() && {className: baseClasses})}
      style={inlineStyles}
      {...props}
    >
      {inline.map((content, index) =>
        renderInlineContent(
          content,
          index,
          inline,
          linkType,
          fSize,
          InlineEmbed,
          onHoverIn,
          onHoverOut,
        ),
      )}
    </span>
  )
}

type LinkType = null | 'basic' | 'hypermedia'

function hmTextColor(linkType: LinkType): string {
  if (linkType === 'basic') return '$color11'
  if (linkType === 'hypermedia') return '$brand5'
  return '$color12'
}

function getInlineContentOffset(inline: HMInlineContent): number {
  if (inline.type === 'link') {
    return inline.content.map(getInlineContentOffset).reduce((a, b) => a + b, 0)
  }
  if (inline.type === 'text') {
    return inline.text?.length || 0
  }
  // For inline-embed, return 1 (represents the embed character)
  return 1
}
