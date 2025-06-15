// @ts-nocheck - Tamagui component typing issues with children props
import {PlainMessage} from '@bufbuild/protobuf'
import {
  BlockNode,
  CONTENT_HIGHLIGHT_COLOR_DARK,
  CONTENT_HIGHLIGHT_COLOR_LIGHT,
  HMBlockChildrenType,
  HMBlockNode,
  HMBlockQuery,
  HMDocument,
  HMEmbedView,
  HMInlineContent,
  UnpackedHypermediaId,
  clipContentBlocks,
  formatBytes,
  getDocumentTitle,
  hmBlockToEditorBlock,
  hmId,
  isHypermediaScheme,
  narrowHmId,
  packHmId,
  pluralS,
  unpackHmId,
  useHover,
  useLowlight,
  useOpenUrl,
  useRangeSelection,
  useRouteLink,
  useRouteLinkHref,
} from '@shm/shared'
import {
  BlockContentProps,
  DocContentContextValue,
  EntityComponentProps,
} from '@shm/shared/document-content-types'
import {
  generateInstagramEmbedHtml,
  loadInstagramScript,
  loadTwitterScript,
} from '@shm/shared/utils/web-embed-scripts'
import {Button, ButtonFrame, ButtonText} from '@tamagui/button'
import {Checkbox, CheckboxProps} from '@tamagui/checkbox'
import {SizeTokens} from '@tamagui/core'
import {Label} from '@tamagui/label'
import {RadioGroup} from '@tamagui/radio-group'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  File,
  Link,
  MessageSquare,
  MoreHorizontal,
  MoveLeft,
  Undo2,
} from 'lucide-react'
import React from 'react'
import {
  extractIpfsUrlCid,
  getDaemonFileUrl,
  isIpfsUrl,
  useFileUrl,
  useImageUrl,
} from './get-file-url'
import {marginClasses} from './heading'
import {SizableText, Text, TextProps} from './text'
import {cn} from './utils'

import {XStack, XStackProps, YStack} from '@tamagui/stacks'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import {common} from 'lowlight'
import {
  ComponentProps,
  PropsWithChildren,
  createContext,
  createElement,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
// import {
//   QuotedTweet,
//   TweetBody,
//   TweetHeader,
//   TweetInReplyTo,
//   TweetInfo,
//   TweetMedia,
//   enrichTweet,
//   useTweet,
// } from "react-tweet";
import {useTxString} from '@shm/shared/translation'
import {contentLayoutUnit, contentTextUnit} from './document-content-constants'
import './document-content.css'
import {BlankQueryBlockMessage} from './entity-card'
import {SeedHeading} from './heading'
import {BlockQuote} from './icons'
import {Spinner} from './spinner'
import {Tooltip} from './tooltip'
import {useIsDark} from './use-is-dark'
import useMedia from './use-media'

export const docContentContext = createContext<DocContentContextValue | null>(
  null,
)

export function DocContentProvider({
  children,
  debugTop = 0,
  showDevMenu = false,
  comment = false,
  routeParams = {},
  layoutUnit = contentLayoutUnit,
  textUnit = contentTextUnit,
  ...docContextContent
}: PropsWithChildren<
  DocContentContextValue & {
    debugTop?: number
    showDevMenu?: boolean
    ffSerif?: boolean
  }
>) {
  const [tUnit, setTUnit] = useState(textUnit)
  const [lUnit, setLUnit] = useState(layoutUnit)
  const [debug, setDebug] = useState(false)
  const [ffSerif, toggleSerif] = useState(true)
  const [collapsedBlocks, setCollapsed] = useState<Set<string>>(new Set())

  const setCollapsedBlocks = (id: string, val: boolean) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (val) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  return (
    <docContentContext.Provider
      value={{
        ...docContextContent,
        layoutUnit: lUnit,
        textUnit: comment ? 14 : tUnit,
        debug,
        ffSerif,
        comment,
        routeParams,
        collapsedBlocks,
        setCollapsedBlocks,
      }}
    >
      {children}
      {showDevMenu ? (
        <div className="z-[9999] p-2 fixed bottom-16 right-16 bg-background-hover border border-border">
          <CheckboxWithLabel
            label="debug"
            checked={debug}
            // @ts-ignore
            onCheckedChange={setDebug}
            size="$1"
          />
          <CheckboxWithLabel
            label="body sans-serif"
            checked={ffSerif}
            // @ts-ignore
            onCheckedChange={toggleSerif}
            size="$1"
          />
          <RadioGroup
            aria-labelledby="text unit"
            defaultValue="18"
            name="form"
            onValueChange={(val) => setTUnit(Number(val))}
          >
            <div className="flex gap-2">
              <SizableText size="xs">Text unit:</SizableText>
              <RadioGroupItemWithLabel value="14" label="14" />
              <RadioGroupItemWithLabel value="16" label="16" />
              <RadioGroupItemWithLabel value="18" label="18" />
              <RadioGroupItemWithLabel value="20" label="20" />
              <RadioGroupItemWithLabel value="24" label="24" />
            </div>
          </RadioGroup>
          <RadioGroup
            aria-labelledby="layout unit"
            defaultValue="24"
            name="form"
            onValueChange={(val) => setLUnit(Number(val))}
          >
            <div className="flex gap-2">
              <SizableText size="$1">Layout unit:</SizableText>
              <RadioGroupItemWithLabel value="16" label="16" />
              <RadioGroupItemWithLabel value="20" label="20" />
              <RadioGroupItemWithLabel value="24" label="24" />
              <RadioGroupItemWithLabel value="28" label="28" />
              <RadioGroupItemWithLabel value="32" label="32" />
            </div>
          </RadioGroup>
        </div>
      ) : null}
    </docContentContext.Provider>
  )
}

export function useDocContentContext() {
  let context = useContext(docContentContext)

  if (!context) {
    throw new Error(`Please wrap <DocContent /> with <DocContentProvider />`)
  }

  return context
}

function debugStyles(debug: boolean = false, color = 'red') {
  return debug
    ? {
        borderWidth: 1,
        borderColor: color,
      }
    : {}
}

function getFocusedBlocks(blocks: HMBlockNode[], blockId?: string) {
  if (!blockId) return blocks
  const focused = getBlockNodeById(blocks, blockId)
  if (focused) return [focused]
  return null
}

// Get attribute from plain JSON format (document) and protobuff format (comments)
function getBlockAttribute(attributes: any, key: string): any {
  if (!attributes) return undefined

  // JSON
  if (key in attributes) return attributes[key]

  // Protobuf Struct
  const field = attributes?.fields?.[key]
  return field?.kind?.value ?? undefined
}

export function DocContent({
  document,
  focusBlockId,
  maxBlockCount,
  handleBlockReplace,
  ...props
}: XStackProps & {
  document: HMDocument
  focusBlockId?: string | undefined
  maxBlockCount?: number
  marginVertical?: any
  handleBlockReplace?: () => boolean
}) {
  const media = useMedia()
  const {wrapper, bubble, coords, state, actor} = useRangeSelection()
  const {layoutUnit, onBlockCopy} = useDocContentContext()
  const allBlocks = document?.content || []
  const focusedBlocks = getFocusedBlocks(allBlocks, focusBlockId)
  const displayBlocks = maxBlockCount
    ? clipContentBlocks(focusedBlocks || [], maxBlockCount)
    : focusedBlocks

  const tx = useTxString()

  useEffect(() => {
    function handleSelectAll(event: KeyboardEvent) {
      if (event.key == 'a' && event.metaKey) {
        event.preventDefault()
        if (wrapper.current) {
          window.getSelection()?.selectAllChildren(wrapper.current)
        }
      }
    }

    window.addEventListener('keydown', handleSelectAll)

    return () => {
      window.removeEventListener('keydown', handleSelectAll)
    }
  }, [])

  useEffect(() => {
    if (media.gtSm) {
      actor.send({type: 'ENABLE'})
    } else {
      actor.send({type: 'DISABLE'})
    }
  }, [media.gtSm])

  return (
    <div
      className="relative my-10"
      ref={wrapper}
      style={{
        paddingHorizontal: layoutUnit / 3,
      }}
      {...props}
    >
      <div
        ref={bubble}
        userSelect="none"
        className={cn(
          'z-50 absolute top-0 left-0 hidden',
          media.gtSm && !state.matches('disable') ? 'block' : 'hidden',
        )}
        style={{...coords}}
      >
        {onBlockCopy ? (
          <Tooltip content={tx('copy_block_range', 'Copy Block Range')}>
            <Button
              size="$2"
              icon={Link}
              onPress={() => {
                onBlockCopy(
                  state.context.blockId,
                  typeof state.context.rangeStart == 'number' &&
                    typeof state.context.rangeEnd == 'number'
                    ? {
                        start: state.context.rangeStart,
                        end: state.context.rangeEnd,
                      }
                    : {
                        expanded: true,
                      },
                )
              }}
            />
          </Tooltip>
        ) : null}
      </div>
      <BlocksContent
        blocks={displayBlocks}
        parentBlockId={null}
        handleBlockReplace={handleBlockReplace}
      />
    </div>
  )
}
export const BlocksContent = memo(_BlocksContent)

function _BlocksContent({
  blocks,
  parentBlockId,
  handleBlockReplace,
  hideCollapseButtons = false,
  expanded = true,
}: {
  blocks?: Array<PlainMessage<BlockNode>> | Array<HMBlockNode> | null
  parentBlockId: string | null
  handleBlockReplace?: () => boolean
  hideCollapseButtons?: boolean
  expanded?: boolean
}) {
  if (!blocks) return null

  return (
    <BlockNodeList childrenType="Group" className="px-2 sm:px-2">
      {blocks?.length
        ? blocks?.map((bn, idx) => (
            <BlockNodeContent
              hideCollapseButtons={hideCollapseButtons}
              parentBlockId={parentBlockId}
              isFirstChild={idx === 0}
              key={bn.block?.id}
              blockNode={bn}
              depth={1}
              childrenType={getBlockAttribute(
                bn.block?.attributes,
                'childrenType',
              )}
              listLevel={1}
              index={idx}
              handleBlockReplace={handleBlockReplace}
              expanded={expanded}
            />
          ))
        : null}
    </BlockNodeList>
  )
}

export function BlockNodeList({
  children,
  childrenType = 'Group',
  listLevel,
  ...props
}: {
  children: React.ReactNode
  childrenType?: HMBlockChildrenType
  listLevel?: string | number
  className?: string
}) {
  const getListClasses = (
    type: HMBlockChildrenType,
    level?: string | number,
  ): string => {
    const classes: string[] = [
      'blocknode-list',
      'w-full',
      'marker:text-muted-foreground marker:text-sm',
    ]

    if (type === 'Unordered') {
      classes.push('list-disc', 'pl-6')
      // if (level === 2) classes.push('list-[circle]')
      // if (level === 3) classes.push('list-[square]')
    } else if (type === 'Ordered') {
      classes.push('list-decimal', 'pl-6')
    } else if (type === 'Blockquote') {
      classes.push(
        'border-l-[3px]',
        'border-gray-400',
        'dark:border-gray-600',
        'pl-4',
        'my-4',
      )
    } else {
      classes.push('pl-6')
    }

    return classes.join(' ')
  }

  const Tag = useMemo(() => {
    if (childrenType === 'Ordered') return 'ol'
    if (childrenType === 'Blockquote') return 'blockquote'
    return 'ul'
  }, [childrenType])

  return (
    <Tag
      className={cn(getListClasses(childrenType, listLevel), props.className)}
      data-node-type="blockGroup"
      data-list-type={childrenType}
      data-list-level={listLevel}
    >
      {children}
    </Tag>
  )
}

export function BlockNodeContent({
  blockNode,
  depth = 1,
  listLevel = 1,
  childrenType = 'Group',
  isFirstChild = false,
  expanded = true,
  embedDepth = 1,
  parentBlockId,
  handleBlockReplace,
  hideCollapseButtons = false,
}: {
  isFirstChild: boolean
  blockNode: BlockNode | HMBlockNode | PlainMessage<BlockNode>
  index: number
  depth?: number
  listLevel?: number
  childrenType?: HMBlockChildrenType
  embedDepth?: number
  expanded?: boolean
  parentBlockId: string | null
  handleBlockReplace?: () => boolean
  hideCollapseButtons?: boolean
}) {
  const {
    layoutUnit,
    routeParams,
    onBlockCitationClick,
    onBlockCommentClick,
    onBlockCopy,
    onBlockReply,
    debug,
    comment,
    blockCitations,
  } = useDocContentContext()
  const [hover, setHover] = useState(false)
  const isDark = useIsDark()
  const headingMarginStyles = useHeadingMarginStyles(
    depth,
    layoutUnit,
    isFirstChild,
  )

  const citationsCount =
    blockNode.block?.id && blockCitations
      ? blockCitations[blockNode.block?.id]
      : undefined

  const [_expanded, setExpanded] = useState<boolean>(expanded)

  useEffect(() => {
    if (expanded !== _expanded) {
      setExpanded(expanded)
    }
  }, [expanded])

  const elm = useRef<HTMLDivElement>(null)
  let bnChildren = blockNode.children?.length
    ? blockNode.children.map((bn, index) => (
        <BlockNodeContent
          hideCollapseButtons={hideCollapseButtons}
          key={bn.block!.id}
          depth={depth + 1}
          isFirstChild={index == 0}
          blockNode={bn}
          childrenType={bn.block!.attributes?.childrenType}
          listLevel={
            childrenType === 'Unordered' &&
            bn.block!.attributes?.childrenType === 'Unordered'
              ? listLevel + 1
              : listLevel
          }
          index={index}
          parentBlockId={blockNode.block?.id || null}
          embedDepth={embedDepth ? embedDepth + 1 : embedDepth}
          handleBlockReplace={handleBlockReplace}
          expanded={_expanded}
        />
      ))
    : null

  const headingStyles = useMemo(() => {
    if (blockNode.block?.type == 'Heading') {
      return headingMarginStyles
    }

    return {}
  }, [blockNode.block, headingMarginStyles])

  const isEmbed = blockNode.block?.type == 'Embed'

  const [isHighlight, setHighlight] = useState(false)

  // Clone block and add the highlight annotation
  const modifiedBlock = useMemo(() => {
    if (
      !(
        routeParams?.blockRef === blockNode.block?.id && routeParams?.blockRange
      )
    )
      return blockNode.block

    const clonedBlock = {
      ...blockNode.block,
      annotations: [...(blockNode!.block!.annotations || [])],
    }

    // Add the highlight annotation
    clonedBlock.annotations.push({
      type: 'Range',
      starts: [routeParams.blockRange.start],
      ends: [routeParams.blockRange.end],
      attributes: {},
    })

    return clonedBlock
  }, [blockNode.block, routeParams?.blockRef, routeParams?.blockRange])

  useEffect(() => {
    let val = routeParams?.blockRef == blockNode.block?.id && !comment

    if (!routeParams?.blockRange || isHighlight) setHighlight(val)

    if (!val || !elm.current) return

    // Uncomment to enable unhighlighting when scrolling outside of the block view.
    // // Add intersection observer to check if the user scrolled out of block view.
    // const observer = new IntersectionObserver(
    //   ([entry]) => {
    //     console.log(entry.isIntersecting);
    //     // && !routeParams.blockRange
    //     if (!entry.isIntersecting) {
    //       handleBlockReplace?.();
    //     }
    //   },
    //   {threshold: 0.1} // Trigger when 10% of the block is still visible.
    // );

    // Function to check if the user clicked outside the block bounds.
    const handleClickOutside = (event: MouseEvent) => {
      if (elm.current && !elm.current.contains(event.target as Node)) {
        handleBlockReplace?.()
      }
    }

    // observer.observe(elm.current);
    document.addEventListener('click', handleClickOutside)

    // Remove listeners when unmounting
    return () => {
      // observer.disconnect();
      document.removeEventListener('click', handleClickOutside)
    }
  }, [routeParams?.blockRef, routeParams?.blockRange, comment, blockNode.block])

  function handleBlockNodeToggle() {
    setExpanded(!_expanded)
  }

  useEffect(() => {
    if (elm.current) {
      if (
        !comment &&
        routeParams &&
        routeParams.blockRef === blockNode.block?.id
      )
        elm.current.scrollIntoView({behavior: 'smooth', block: 'start'})
    }
  }, [routeParams])

  const contentH = useMemo(() => {
    // this calculates the position the collapse button should be at, based on the height of the content
    // and the height of the heading
    if (elm.current) {
      const contentNode = elm.current.querySelector('.block-content')

      if (contentNode) {
        const rect = contentNode.getBoundingClientRect()

        return rect.height / 2 - (layoutUnit * 1) / 2
      } else {
        return 4
      }
    }
  }, [elm.current, blockNode.block])

  // const isMediablock = useMemo(() => {
  //   return ['Image', 'Video', 'File', 'Embed', 'WebEmbed', 'Query'].includes(
  //     blockNode.block!.type,
  //   )
  // }, [blockNode.block])

  const tx = useTxString()

  console.log('hover', hover)

  const highlightColor = isDark
    ? CONTENT_HIGHLIGHT_COLOR_DARK
    : CONTENT_HIGHLIGHT_COLOR_LIGHT

  // // @ts-expect-error
  // if (isBlockNodeEmpty(blockNode)) {
  //   return null;
  // }

  return (
    <div
      id={comment ? undefined : blockNode.block?.id}
      ref={elm}
      data-node-type="blockContainer"
      data-block-type={blockNode.block?.type}
      className={cn(
        'blocknode-content border-px',
        isHighlight
          ? 'border-brand-12 bg-brand-10'
          : 'border-transparent bg-transparent',
      )}
      style={{
        borderRadius: layoutUnit / 4,
      }}
    >
      <div
        style={{
          borderRadius: layoutUnit / 4,
          padding: layoutUnit / 3,
          paddingVertical: isEmbed ? 0 : layoutUnit / 6,
        }}
        {...debugStyles(debug, 'red')}
        className={cn(
          'relative',
          blockNode.block?.type == 'Embed' && 'hover:bg-brand-12',
          blockNode.block!.type == 'Heading' && 'blocknode-content-heading',
          headingStyles.className,
        )}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {!hideCollapseButtons && bnChildren ? (
          <Tooltip
            delay={1000}
            content={
              _expanded
                ? tx(
                    'collapse_block',
                    'You can collapse this block and hide its children',
                  )
                : tx(
                    'block_is_collapsed',
                    'This block is collapsed. you can expand it and see its children',
                  )
            }
          >
            <Button
              size="$1"
              x={-24}
              y={contentH}
              chromeless
              width={layoutUnit}
              height={layoutUnit * 0.75}
              icon={_expanded ? ChevronDown : ChevronRight}
              onPress={(e) => {
                e.stopPropagation()
                handleBlockNodeToggle()
              }}
              userSelect="none"
              position="absolute"
              zIndex="$zIndex.5"
              left={0}
              top={
                ['Unordered', 'Ordered'].includes(childrenType) ? 12 : undefined
              }
              opacity={hover ? 1 : _expanded ? 0 : 1}
              hoverStyle={{
                opacity: 1,
              }}
              bg="$background"
            />
          </Tooltip>
        ) : null}

        <BlockContent
          block={modifiedBlock}
          depth={depth}
          parentBlockId={parentBlockId}
          // {...interactiveProps}
        />
        {!hideCollapseButtons && bnChildren && !_expanded ? (
          <Tooltip
            content={tx(
              'block_is_collapsed',
              'This block is collapsed. you can expand it and see its children',
            )}
          >
            <Button
              userSelect="none"
              marginHorizontal={layoutUnit / 4}
              size="$1"
              alignSelf="center"
              icon={MoreHorizontal}
              onPress={(e) => {
                e.stopPropagation()
                handleBlockNodeToggle()
              }}
            />
          </Tooltip>
        ) : null}
        <div
          className={cn(
            'absolute z-10 top-0 right-0 sm:right-[-44px] pl-4 gap-2',
            hover && 'z-[999]',
          )}
          style={{
            borderRadius: layoutUnit / 4,
          }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          {citationsCount?.citations ? (
            <Tooltip
              content={tx(
                'block_citation_count',
                ({count}) =>
                  `${count} ${pluralS(count, 'document')} citing this block`,
                {count: citationsCount.citations},
              )}
              delay={800}
            >
              <Button
                userSelect="none"
                size="$1"
                background={isDark ? '$background' : '$backgroundStrong'}
                padding={layoutUnit / 4}
                borderRadius={layoutUnit / 4}
                onPress={() => onBlockCitationClick?.(blockNode.block?.id)}
                icon={
                  <BlockQuote
                    size={12}
                    color="currentColor"
                    className="opacity-50"
                  />
                }
              >
                <SizableText color="muted" size="xs">
                  {citationsCount.citations
                    ? String(citationsCount.citations)
                    : ' '}
                </SizableText>
              </Button>
            </Tooltip>
          ) : null}

          {onBlockReply ? (
            <Tooltip content="Reply to block" delay={800}>
              <Button
                userSelect="none"
                size="$1"
                // background={isDark ? '$background' : '$backgroundStrong'}
                opacity={hover ? 1 : 0}
                icon={
                  <MessageSquare
                    size={12}
                    color="currentColor"
                    className="opacity-50"
                  />
                }
                padding={layoutUnit / 4}
                borderRadius={layoutUnit / 4}
                onPress={() => {
                  if (blockNode.block?.id) {
                    onBlockReply(blockNode.block.id)
                  } else {
                    console.error('onBlockReply Error: no blockId available')
                  }
                }}
              />
            </Tooltip>
          ) : null}
          {onBlockCommentClick ? (
            <Tooltip
              content={
                citationsCount?.comments
                  ? tx(
                      'block_comment_count',
                      ({count}) => `${count} ${pluralS(count, 'comment')}`,
                      {count: citationsCount.comments},
                    )
                  : tx('Comment on this block')
              }
              delay={800}
            >
              <Button
                userSelect="none"
                size="$1"
                background={isDark ? '$background' : '$backgroundStrong'}
                opacity={citationsCount?.comments ? 1 : hover ? 1 : 0}
                padding={layoutUnit / 4}
                borderRadius={layoutUnit / 4}
                onPress={() => {
                  if (blockNode.block?.id) {
                    onBlockCommentClick(
                      blockNode.block.id,
                      undefined,
                      citationsCount?.comments ? false : true, // start commenting now if no comments, otherwise just open
                    )
                  } else {
                    console.error(
                      'onBlockCommentClick Error: no blockId available',
                    )
                  }
                }}
                icon={
                  <MessageSquare
                    size={12}
                    color="currentColor"
                    className="opacity-50"
                  />
                }
              >
                <SizableText color="muted" size="xs">
                  {citationsCount?.comments
                    ? String(citationsCount.comments)
                    : ' '}
                </SizableText>
              </Button>
            </Tooltip>
          ) : null}
          {onBlockCopy ? (
            <Tooltip
              content={tx(
                'copy_block_exact',
                'Copy Block Link (Exact Version)',
              )}
              delay={800}
            >
              <Button
                userSelect="none"
                size="$1"
                opacity={hover ? 1 : 0}
                padding={layoutUnit / 4}
                borderRadius={layoutUnit / 4}
                background={isDark ? '$background' : '$backgroundStrong'}
                icon={
                  <Link size={12} color="currentColor" className="opacity-50" />
                }
                onPress={() => {
                  if (blockNode.block?.id) {
                    onBlockCopy(blockNode.block.id, {expanded: true})
                  } else {
                    console.error('onBlockCopy Error: no blockId available')
                  }
                }}
              >
                <SizableText color="muted" size="xs">
                  {' '}
                </SizableText>
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </div>
      {bnChildren && _expanded ? (
        <BlockNodeList
          childrenType={blockNode.block?.attributes?.childrenType}
          listLevel={listLevel}
        >
          {bnChildren}
        </BlockNodeList>
      ) : null}
    </div>
  )
}

function isBlockNodeEmpty(bn: HMBlockNode): boolean {
  if (bn.children && bn.children.length) return false
  if (typeof bn.block == 'undefined') return true
  switch (bn.block.type) {
    case 'Paragraph':
    case 'Heading':
    case 'Math':
    case 'Code':
      return !bn.block.text
    case 'Image':
    case 'File':
    case 'Video':
    // case "nostr":
    case 'Embed':
    case 'WebEmbed':
      return !bn.block.link
    default:
      return false
  }
}

export const blockStyles = 'w-full flex-1 self-center'

function BlockContent(props: BlockContentProps) {
  const dataProps = {
    depth: props.depth || 1,
    'data-blockid': props.block.id,
  }
  if (props.block.type == 'Paragraph') {
    return <BlockContentParagraph {...props} {...dataProps} />
  }

  if (props.block.type == 'Heading') {
    return <BlockContentHeading {...props} {...dataProps} />
  }

  if (props.block.type == 'Image') {
    return <BlockContentImage {...props} {...dataProps} />
  }

  if (props.block.type == 'Video') {
    return <BlockContentVideo {...props} {...dataProps} />
  }

  // if (props.block.type == "nostr") {
  //   return <BlockContentNostr {...props} {...dataProps} />;
  // }

  if (props.block.type == 'File') {
    return <BlockContentFile {...props} {...dataProps} />
  }

  if (props.block.type == 'Button') {
    return <BlockContentButton {...props} {...dataProps} />
  }

  if (props.block.type == 'WebEmbed') {
    return <BlockContentWebEmbed {...props} {...dataProps} />
  }

  if (props.block.type == 'Embed') {
    return <BlockContentEmbed {...props} {...dataProps} />
  }

  if (props.block.type == 'Code') {
    return <BlockContentCode {...props} {...dataProps} />
  }

  if (props.block.type == 'Math') {
    return <BlockContentMath {...props} block={props.block} />
  }

  if (props.block.type == 'Query') {
    return <BlockContentQuery {...props} block={props.block} />
  }

  return <BlockContentUnknown {...props} />
}

function BlockContentParagraph({
  block,
  parentBlockId,
  ...props
}: BlockContentProps) {
  const {debug, textUnit, comment} = useDocContentContext()

  let inline = useMemo(() => {
    const editorBlock = hmBlockToEditorBlock(block)
    return editorBlock.content
  }, [block])
  return (
    <Text
      {...props}
      {...debugStyles(debug, 'blue')}
      className={cn(
        'block-content block-paragraph content-inline',
        comment && 'is-comment',
        blockStyles,
      )}
      asChild
    >
      <p>
        <InlineContentView inline={inline} />
      </p>
    </Text>
  )
}

export function BlockContentHeading({
  block,
  depth,
  parentBlockId,
  ...props
}: BlockContentProps) {
  const {debug} = useDocContentContext()
  let inline = useMemo(() => hmBlockToEditorBlock(block).content, [block])

  return (
    <SeedHeading
      {...props}
      {...debugStyles(debug, 'blue')}
      level={depth as 1 | 2 | 3 | 4 | undefined}
      className={cn('block-content block-heading', blockStyles)}
      maxWidth="95%"
    >
      <InlineContentView inline={inline} fontWeight="bold" fontSize={null} />
    </SeedHeading>
  )
}

export function useHeadingMarginStyles(
  depth: number,
  unit: number,
  isFirst?: boolean,
) {
  return useMemo(() => {
    if (isFirst) {
      return {
        className: 'mt-0',
      } satisfies TextProps
    }

    return {
      className:
        marginClasses[depth as keyof typeof marginClasses] ||
        marginClasses.default,
    } satisfies TextProps
  }, [depth, isFirst])
}

function BlockContentImage({
  block,
  parentBlockId,
  ...props
}: BlockContentProps) {
  let inline = useMemo(() => hmBlockToEditorBlock(block).content, [block])
  const {textUnit} = useDocContentContext()
  const imageUrl = useImageUrl()
  if (block.type !== 'Image') return null
  if (!block?.link) return null
  return (
    <div
      {...props}
      className={cn(
        'block-content block-image max-w-full py-3 items-center flex flex-col w-full gap-2',
        blockStyles,
      )}
      data-content-type="image"
      data-url={block?.link}
      data-name={block?.attributes?.name}
      data-width={getBlockAttribute(block.attributes, 'width')}
    >
      <div
        className={cn('max-w-full')}
        style={{
          width: getBlockAttribute(block.attributes, 'width')
            ? `${getBlockAttribute(block.attributes, 'width')}px`
            : undefined,
        }}
        maxWidth="100%"
      >
        <img
          alt={block?.attributes?.name}
          src={imageUrl(block?.link, 'L')}
          style={{
            width: '100%',
            maxHeight: '600px',
            objectFit: 'contain',
          }}
        />
      </div>
      {inline.length ? (
        <InlineContentView
          inline={inline}
          fontSize={textUnit * 0.85}
          className="text-muted-foreground"
        />
      ) : null}
    </div>
  )
}

function BlockContentVideo({
  block,
  parentBlockId,
  ...props
}: BlockContentProps) {
  let inline = useMemo(() => hmBlockToEditorBlock(block).content, [block])
  const link = block.link || ''
  const {textUnit} = useDocContentContext()
  const fileUrl = useFileUrl()
  if (block.type !== 'Video') return null
  const isIpfs = isIpfsUrl(link)

  return (
    <div
      {...props}
      className={cn(
        'block-content block-video max-w-full py-3 items-center flex flex-col w-full gap-2',
        blockStyles,
      )}
      data-content-type="video"
      data-url={link}
      data-name={getBlockAttribute(block.attributes, 'name')}
      position="relative"
      width="100%"
      ai="center"
    >
      {link ? (
        <div
          className={cn('aspect-video w-full max-w-full relative')}
          style={{
            width: getBlockAttribute(block.attributes, 'width')
              ? `${getBlockAttribute(block.attributes, 'width')}px`
              : '100%',
          }}
        >
          {isIpfs ? (
            <video
              className={cn('absolute top-0 left-0 w-full h-full')}
              // @ts-expect-error this is a bug in tamagui
              contentEditable={false}
              playsInline
              controls
              preload="auto"
            >
              <source
                src={fileUrl(link)}
                type={getSourceType(
                  getBlockAttribute(block.attributes, 'name'),
                )}
              />
            </video>
          ) : (
            <iframe
              className={cn('absolute top-0 left-0 w-full h-full')}
              src={getVideoIframeSrc(block.link)}
              frameBorder="0"
              allowFullScreen
            />
          )}
        </div>
      ) : (
        <Text>Video block wrong state</Text>
      )}
      {inline.length ? (
        <Text className="text-muted-foreground" asChild>
          <InlineContentView fontSize={textUnit * 0.85} inline={inline} />
        </Text>
      ) : null}
    </div>
  )
}

function getVideoIframeSrc(link: string) {
  const url = new URL(link)
  if (url.host.includes('youtube.com')) {
    url.searchParams.set('rel', '0')
    return url.toString()
  }
  return link
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
  return inline.text?.length || 0
}

function InlineContentView({
  inline,
  linkType = null,
  fontSize,
  fontWeight,
  rangeOffset,
  isRange = false,
  ...props
}: {
  inline: HMInlineContent[]
  linkType?: LinkType
  fontSize?: number | null
  rangeOffset?: number
  isRange?: boolean
  fontWeight?: string
} & React.HTMLAttributes<HTMLSpanElement>) {
  const {textUnit, entityComponents, comment, onHoverIn, onHoverOut} =
    useDocContentContext()

  const InlineEmbed = entityComponents.Inline
  let contentOffset = rangeOffset || 0
  const fSize = fontSize === null ? null : fontSize || textUnit

  const getLinkColor = (linkType: LinkType): string => {
    if (linkType === 'basic')
      return 'text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300'
    if (linkType === 'hypermedia')
      return 'text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300'
    return ''
  }

  const buildStyleClasses = (styles: any): string => {
    const classes: string[] = []

    if (styles.bold) classes.push('font-bold')
    if (styles.italic) classes.push('italic')
    if (styles.code)
      classes.push(
        'font-mono bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-xs border border-gray-200 dark:border-gray-700',
      )
    if (styles.underline) classes.push('underline')
    if (styles.strike) classes.push('line-through')
    if (styles.range || isRange)
      classes.push('bg-yellow-200/50 dark:bg-yellow-900/70')

    return classes.join(' ')
  }

  const buildTextDecorationStyle = (
    styles: any,
    linkType: LinkType,
  ): React.CSSProperties => {
    const decorations: string[] = []

    if (linkType || styles.underline) decorations.push('underline')
    if (styles.strike) decorations.push('line-through')

    return decorations.length > 0
      ? {
          textDecorationLine: decorations.join(' ') as any,
          textDecorationColor: 'currentColor',
        }
      : {}
  }

  return (
    <>
      {inline.map((content, index) => {
        const inlineContentOffset = contentOffset
        contentOffset += getInlineContentOffset(content)

        if (content.type === 'text') {
          const styleClasses = buildStyleClasses(content.styles)
          const textDecorationStyle = buildTextDecorationStyle(
            content.styles,
            linkType,
          )
          const linkColorClass = getLinkColor(linkType)

          // Handle line breaks - only split if it's the last item and has multiple lines
          let children: React.ReactNode = content.text
          if (inline.length === index + 1 && content.text.includes('\n')) {
            children = content.text.split('\n').map((line, i, arr) => (
              <React.Fragment key={i}>
                {line}
                {i < arr.length - 1 && <br />}
              </React.Fragment>
            ))
          }

          // Make code text smaller
          const actualFontSize =
            fSize === null ? null : content.styles.code ? fSize * 0.85 : fSize

          const dynamicStyles: React.CSSProperties = {
            lineHeight: 1.5,
            ...textDecorationStyle,
          }

          if (actualFontSize !== null) {
            dynamicStyles.fontSize = actualFontSize
          }

          return (
            <span
              key={`${content.type}-${index}`}
              className={cn(
                'whitespace-pre-wrap',
                linkColorClass,
                styleClasses,
                fontWeight && `font-${fontWeight}`,
                props.className,
              )}
              style={dynamicStyles}
              data-range-offset={inlineContentOffset}
            >
              {children}
            </span>
          )
        }

        if (content.type === 'link') {
          const isHmScheme = isHypermediaScheme(content.href)
          const {onPress, ...linkProps} = useRouteLinkHref(content.href)
          const id = unpackHmId(content.href)

          return (
            <a
              key={index}
              {...linkProps}
              onClick={onPress}
              className={cn(
                'cursor-pointer transition-colors',
                isHmScheme ? 'hm-link' : 'link',
              )}
              target={isHmScheme ? undefined : '_blank'}
              onMouseEnter={id ? () => onHoverIn?.(id) : undefined}
              onMouseLeave={id ? () => onHoverOut?.(id) : undefined}
              data-blockid={id?.blockRef}
              data-docid={id?.blockRef ? undefined : id?.id}
            >
              <InlineContentView
                inline={content.content}
                fontSize={fSize}
                linkType={isHmScheme ? 'hypermedia' : 'basic'}
                rangeOffset={inlineContentOffset}
                fontWeight={fontWeight}
              />
            </a>
          )
        }

        if (content.type === 'inline-embed') {
          const unpackedRef = unpackHmId(content.link)
          return (
            <InlineEmbed
              key={content.link}
              comment={comment}
              {...unpackedRef}
            />
          )
        }

        if (content.type === 'range') {
          return (
            <Text
              asChild
              key={index}
              className="bg-yellow-200/50 dark:bg-yellow-900/70"
            >
              <InlineContentView
                inline={content.content}
                fontSize={fSize}
                rangeOffset={inlineContentOffset}
                isRange={true}
                fontWeight={fontWeight}
              />
            </Text>
          )
        }

        return null
      })}
    </>
  )
}

function HrefLink({
  href,
  children,
  buttonProps,
  onHoverIn,
  onHoverOut,
}: PropsWithChildren<{
  href: string
  buttonProps: ComponentProps<'a'>
  onHoverIn?: (id: UnpackedHypermediaId) => void
  onHoverOut?: (id: UnpackedHypermediaId) => void
}>) {
  const {onPress, ...linkProps} = useRouteLinkHref(href)
  const id = unpackHmId(href)
  return (
    <a
      {...linkProps}
      onClick={onPress}
      {...buttonProps}
      // this data attribute is used by the hypermedia highlight component
      onMouseEnter={id ? () => onHoverIn?.(id) : undefined}
      onMouseLeave={id ? () => onHoverOut?.(id) : undefined}
      data-blockid={id?.blockRef}
      data-docid={id?.blockRef ? undefined : id?.id}
    >
      {children}
    </a>
  )
}

export function BlockContentEmbed(props: BlockContentProps) {
  const EmbedTypes = useDocContentContext().entityComponents
  if (props.block.type !== 'Embed')
    throw new Error('BlockContentEmbed requires an embed block type')
  const id = unpackHmId(props.block.link)
  if (id?.type == 'd') {
    return <EmbedTypes.Document {...props} {...id} />
  }
  if (id?.type == 'c') {
    return <EmbedTypes.Comment {...props} {...id} />
  }
  return <BlockContentUnknown {...props} />
}

export function ErrorBlock({
  message,
  debugData,
}: {
  message: string
  debugData?: any
}) {
  let [open, toggleOpen] = useState(false)
  return (
    <Tooltip
      content={debugData ? (open ? 'Hide debug Data' : 'Show debug data') : ''}
    >
      <div className="block-content block-unknown flex flex-col flex-1">
        <ButtonFrame
          theme="red"
          gap="$2"
          onPress={(e) => {
            e.stopPropagation()
            toggleOpen((v) => !v)
          }}
        >
          <SizableText color="danger">
            {message ? message : 'Error'}
          </SizableText>
          <AlertCircle color="danger" size={12} />
        </ButtonFrame>
        {open ? (
          <pre className="bg-gray-100 dark:bg-gray-800 p-2 rounded-md border border-border">
            <code className="text-xs wrap-break-word font-mono">
              {JSON.stringify(debugData, null, 4)}
            </code>
          </pre>
        ) : null}
      </div>
    </Tooltip>
  )
}

export function ContentEmbed({
  props,
  document,
  isLoading,
  showReferenced,
  onShowReferenced,
  renderOpenButton,
  EmbedWrapper,
  parentBlockId = null,
}: {
  isLoading: boolean
  props: EntityComponentProps
  document: HMDocument | null | undefined
  showReferenced: boolean
  onShowReferenced: (showReference: boolean) => void
  renderOpenButton: () => React.ReactNode
  EmbedWrapper: React.ComponentType<
    React.PropsWithChildren<{
      id: UnpackedHypermediaId
      depth: number
      parentBlockId: string
      embedView?: HMEmbedView
    }>
  >
  parentBlockId: string | null
}) {
  const context = useDocContentContext()

  const [isExpanded, setExpanded] = useState(props.blockRange?.expanded ?? true)

  useEffect(() => {
    setExpanded(context.collapsedBlocks.has(props.block.id) ? isExpanded : true)
  }, [context.collapsedBlocks])

  const embedData = useMemo(() => {
    const selectedBlock =
      props.blockRef && document?.content
        ? getBlockNodeById(document.content, props.blockRef)
        : null

    const currentAnnotations = selectedBlock?.block?.annotations || []
    const embedBlocks = props.blockRef
      ? selectedBlock
        ? [
            {
              ...selectedBlock,
              block: {
                ...selectedBlock.block,
                annotations:
                  props.blockRange && 'start' in props.blockRange
                    ? [
                        ...currentAnnotations,
                        {
                          type: 'Range',
                          starts: [props.blockRange.start],
                          ends: [props.blockRange.end],
                        },
                      ]
                    : currentAnnotations,
              },
              // children:
              //   props.blockRange &&
              //   'expanded' in props.blockRange &&
              //   props.blockRange.expanded
              //     ? [...selectedBlock.children]
              //     : [],
            },
          ]
        : null
      : document?.content
    let res = {
      ...document,
      data: {
        document,
        embedBlocks,
        blockRange:
          props.blockRange && 'start' in props.blockRange && selectedBlock
            ? {
                blockId: props.blockRef,
                start: props.blockRange.start,
                end: props.blockRange.end,
              }
            : null,
      },
    }
    return res
  }, [props.blockRef, props.blockRange, document])

  let content: null | JSX.Element = <BlockContentUnknown {...props} />
  if (isLoading) {
    content = null
  } else if (embedData.data.embedBlocks) {
    content = (
      <>
        {/* ADD SIDENOTE HERE */}
        <BlockNodeList childrenType="Group">
          {!props.blockRef && document?.metadata?.name ? (
            <BlockNodeContent
              parentBlockId={props.parentBlockId}
              isFirstChild
              depth={props.depth}
              expanded={isExpanded}
              blockNode={{
                block: {
                  type: 'Heading',
                  id: `heading-${props.uid}`,
                  text: getDocumentTitle(document) || '',
                  attributes: {
                    childrenType: 'Group',
                  },
                  annotations: [],
                },
                children: embedData.data.embedBlocks as Array<HMBlockNode>,
              }}
              childrenType="Group"
              index={0}
              embedDepth={1}
            />
          ) : (
            embedData.data.embedBlocks.map((bn, idx) => (
              <BlockNodeContent
                key={bn.block?.id}
                isFirstChild={
                  !props.blockRef && document?.metadata?.name ? true : idx == 0
                }
                depth={1}
                expanded={!!props.blockRange?.expanded || false}
                blockNode={bn}
                childrenType="Group"
                index={idx}
                embedDepth={1}
              />
            ))
          )}
        </BlockNodeList>
        {showReferenced ? (
          <div className="flex justify-end">
            <Tooltip content="The latest reference was not found. Click to try again.">
              <Button
                size="$2"
                theme="red"
                icon={Undo2}
                onPress={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  onShowReferenced(false)
                }}
              >
                Back to Reference
              </Button>
            </Tooltip>
          </div>
        ) : null}
      </>
    )
  } else if (props.blockRef) {
    return (
      <BlockNotFoundError
        message={`Block #${props.blockRef} was not found in this version`}
      >
        <div className="flex gap-2 p-4">
          {props.version ? (
            <Button
              size="$2"
              onPress={() => {
                onShowReferenced(true)
              }}
              icon={MoveLeft}
            >
              Show Referenced Version
            </Button>
          ) : null}
          {renderOpenButton()}
        </div>
      </BlockNotFoundError>
    )
  }
  return (
    <DocContentProvider
      {...context}
      layoutUnit={context.comment ? 18 : context.layoutUnit}
      textUnit={context.comment ? 12 : context.textUnit}
    >
      <EmbedWrapper
        embedView={props.block.attributes?.view}
        depth={props.depth}
        id={narrowHmId(props)}
        parentBlockId={parentBlockId || ''}
      >
        {content}
      </EmbedWrapper>
    </DocContentProvider>
  )
}

function ErrorBlockMessage({message}: {message: string}) {
  return (
    <div className="bg-muted p-4 rounded-md flex items-center">
      <SizableText size="md">{message}</SizableText>
    </div>
  )
}

// document -> BlockContentQuery -> EntityTypes.Query(block, id) -> QueryBlockDesktop / QueryBlockWeb
// editor -> QueryBlock -> EditorQueryBlock
export function BlockContentQuery({block}: {block: HMBlockQuery}) {
  const EntityTypes = useDocContentContext().entityComponents
  if (block.type !== 'Query')
    throw new Error('BlockContentQuery requires a Query block type')

  const query = block.attributes.query
  const mainInclude = query.includes[0]
  if (!mainInclude)
    return <ErrorBlockMessage message="Query block with nothing included" />
  const id =
    mainInclude.space &&
    hmId('d', query.includes[0].space, {
      path: query.includes[0].path ? query.includes[0].path.split('/') : null,
      latest: true,
    })
  if (!id) return <BlankQueryBlockMessage message="Empty Query" />
  return <EntityTypes.Query block={block} id={id} />
}

export function BlockNotFoundError({
  message,
  children,
}: PropsWithChildren<{
  message: string
}>) {
  return (
    <div className="bg-red-100/50 dark:bg-red-900/50 flex flex-col flex-1 p-2">
      <div className="flex gap-2 p-4 items-center">
        <AlertCircle className="text-red-500 flex-0" size={12} />
        <SizableText className="flex-1" color="danger">
          {message ? message : 'Error'}
        </SizableText>
      </div>
      {children}
    </div>
  )
}

export function BlockContentUnknown(props: BlockContentProps) {
  let message = 'Unrecognized Block'
  if (props.block.type == 'Embed') {
    message = `Unrecognized Embed: ${props.block.link}`
  }
  return <ErrorBlock message={message} debugData={props.block} />
}

export function getBlockNodeById(
  blocks: Array<HMBlockNode>,
  blockId: string,
): HMBlockNode | null {
  if (!blockId) return null

  let res: HMBlockNode | undefined
  blocks.find((bn) => {
    if (bn.block?.id == blockId) {
      res = bn
      return true
    } else if (bn.children?.length) {
      const foundChild = getBlockNodeById(bn.children, blockId)
      if (foundChild) {
        res = foundChild
        return true
      }
    }
    return false
  })
  return res || null
}

export function BlockContentFile({block}: BlockContentProps) {
  const {hover, ...hoverProps} = useHover()
  const {layoutUnit, saveCidAsFile} = useDocContentContext()
  const fileCid = block.link ? extractIpfsUrlCid(block.link) : ''
  if (block.type !== 'File') return null
  return (
    <div
      data-content-type="file"
      data-url={block.link}
      data-name={getBlockAttribute(block.attributes, 'name')}
      data-size={getBlockAttribute(block.attributes, 'size')}
      {...hoverProps}
      className={cn(
        'block-content block-file border border-muted dark:border-muted rounded-md p-4 overflow-hidden',
      )}
    >
      <div className="flex items-center gap-2 flex-1 w-full">
        <File size={18} className="flex-0" />
        <SizableText className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap select-text text-sm">
          {getBlockAttribute(block.attributes, 'name') || 'Untitled File'}
        </SizableText>
        {getBlockAttribute(block.attributes, 'size') && (
          <SizableText color="muted" size="xs">
            {formatBytes(parseInt(getBlockAttribute(block.attributes, 'size')))}
          </SizableText>
        )}

        {fileCid && (
          <Tooltip
            content={`Download ${
              getBlockAttribute(block.attributes, 'name') || 'File'
            }`}
          >
            <Button
              position="absolute"
              right={0}
              opacity={hover ? 1 : 0}
              disabled={!hover}
              size="$2"
              {...(saveCidAsFile
                ? {
                    onPress: () => {
                      saveCidAsFile(
                        fileCid,
                        getBlockAttribute(block.attributes, 'name') || 'File',
                      )
                    },
                  }
                : {
                    tag: 'a',
                    download:
                      getBlockAttribute(block.attributes, 'name') || true,
                    href: getDaemonFileUrl(fileCid),
                    style: {
                      textDecoration: 'none',
                    },
                  })}
            >
              Download
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  )
}

export function BlockContentButton({
  block,
  parentBlockId,
  ...props
}: BlockContentProps) {
  const {hover, ...hoverProps} = useHover()
  const buttonLink = block.type === 'Button' ? block.link : null
  const linkProps = useRouteLinkHref(buttonLink || '')
  if (!block.attributes) {
    console.error('Button Block without attributes?!', block)
  }
  if (block.type !== 'Button') return null
  return (
    <XStack
      width="100%"
      justifyContent={
        getBlockAttribute(block.attributes, 'alignment') || 'flex-start'
      }
      userSelect="none"
      className="block-content block-file"
      data-content-type="file"
      maxWidth="100%"
      data-url={block.link}
      data-name={getBlockAttribute(block.attributes, 'name')}
      {...props}
      {...hoverProps}
    >
      <XStack
        position="relative"
        // @ts-ignore
        contentEditable={false}
        maxWidth="100%"
      >
        <Button
          borderWidth={0}
          bg="$brand5"
          color="white"
          width="100%"
          justifyContent="center"
          textAlign="center"
          userSelect="none"
          borderColor="$colorTransparent"
          {...linkProps}
          size="$5"
          maxWidth="100%"
          hoverStyle={{
            bg: '$brand4',
            borderWidth: 0,
          }}
          focusStyle={{
            bg: '$brand3',
            borderWidth: 0,
          }}
        >
          <SizableText
            size="$5"
            numberOfLines={1}
            ellipsizeMode="tail"
            fontWeight="bold"
            color="white"
          >
            {getBlockAttribute(block.attributes, 'name')}
          </SizableText>
        </Button>
      </XStack>
    </XStack>
  )
}

// export function BlockContentNostr({
//   block,
//   parentBlockId,
//   ...props
// }: BlockContentProps) {
//   console.log("BlockContentNostr", block);
//   const {layoutUnit} = useDocContentContext();
//   const name = getBlockAttribute(block.attributes, 'name') ?? "";
//   const nostrNpud = nip19.npubEncode(name) ?? "";

//   const [verified, setVerified] = useState<boolean>();
//   const [content, setContent] = useState<string>();

//   const uri = `nostr:${nostrNpud}`;
//   const header = `${nostrNpud.slice(0, 6)}...${nostrNpud.slice(-6)}`;

//   if (
//     block.ref &&
//     block.ref !== "" &&
//     (content === undefined || verified === undefined)
//   ) {
//     fetch(getDaemonFileUrl(block.ref), { // TODO WHEN BRINGING BACK NOSTR: use useImageUrl
//       method: "GET",
//     }).then((response) => {
//       if (response) {
//         response.text().then((text) => {
//           if (text) {
//             const fileEvent = JSON.parse(text);
//             if (content === undefined) setContent(fileEvent.content);
//             if (verified === undefined && validateEvent(fileEvent)) {
//               setVerified(verifySignature(fileEvent));
//             }
//           }
//         });
//       }
//     });
//   }

//   return (
//     <YStack
//       // backgroundColor="$color3"
//       borderColor="$color6"
//       borderWidth={1}
//       borderRadius={layoutUnit / 4}
//       padding={layoutUnit / 2}
//       overflow="hidden"
//       width="100%"
//       className="block-content block-nostr"
//       hoverStyle={{
//         backgroundColor: "$backgroundHover",
//       }}
//       {...props}
//     >
//       <XStack justifyContent="space-between">
//         <SizableText
//           size="$5"
//           maxWidth="17em"
//           overflow="hidden"
//           textOverflow="ellipsis"
//           whiteSpace="nowrap"
//           userSelect="text"
//           flex={1}
//         >
//           {"Public Key: "}
//           {nip21.test(uri) ? <a href={uri}>{header}</a> : {header}}
//         </SizableText>
//         <Tooltip
//           content={
//             verified === undefined
//               ? ""
//               : verified
//               ? "Signature verified"
//               : "Invalid signature"
//           }
//         >
//           <Button
//             size="$2"
//             disabled
//             theme={
//               verified === undefined ? "blue" : verified ? "green" : "orange"
//             }
//             icon={
//               verified === undefined
//                 ? RiRefreshLine
//                 : verified
//                 ? RiCheckFill
//                 : RiCloseCircleLine
//             }
//           />
//         </Tooltip>
//       </XStack>
//       <XStack justifyContent="space-between">
//         <Text size="$6" fontWeight="bold">
//           {content}
//         </Text>
//       </XStack>
//     </YStack>
//   );
// }

export function BlockContentWebEmbed({
  block,
  parentBlockId,
  ...props
}: BlockContentProps) {
  const {layoutUnit} = useDocContentContext()
  const openUrl = useOpenUrl()
  const url = block.link || ''
  const isTwitter = /(?:twitter\.com|x\.com)/.test(url)
  const isInstagram = /instagram\.com/.test(url)
  const containerRef = useRef(null)
  const isInitialized = useRef(false)
  const [loading, setLoading] = useState(false)
  const createdTweets = useRef(new Set())

  const xPostId = url.split('/').pop()?.split('?')[0]

  useEffect(() => {
    const initializeEmbed = async () => {
      setLoading(true)

      try {
        if (isTwitter) {
          const twttr = await loadTwitterScript()
          if (!isInitialized.current && twttr && containerRef.current) {
            if (!createdTweets.current.has(block.id)) {
              createdTweets.current.add(block.id)
              const result = await twttr.widgets.createTweet(
                xPostId!,
                containerRef.current,
                {
                  theme: 'dark',
                  align: 'center',
                },
              )
              isInitialized.current = true
              if (!result) console.log('error???')
            }
          }
        } else if (isInstagram) {
          if (containerRef.current) {
            containerRef.current.innerHTML = generateInstagramEmbedHtml(url)
            loadInstagramScript()
            setTimeout(() => {
              try {
                ;(window as any).instgrm?.Embeds?.process()
              } catch (e) {
                console.warn('Instagram embed error:', e)
              }
            }, 300)
          }
        }
      } catch (e) {
        console.error('Web embed error:', e)
      } finally {
        setLoading(false)
      }
    }

    initializeEmbed()
    return () => {
      isInitialized.current = false
    }
  }, [url])

  return (
    <YStack
      {...props}
      borderColor="$color6"
      backgroundColor="$color4"
      borderWidth={1}
      borderRadius={layoutUnit / 4}
      padding={layoutUnit / 2}
      overflow="hidden"
      width="100%"
      marginHorizontal={(-1 * layoutUnit) / 2}
      className={cn('x-post-container', blockStyles)}
      data-content-type="web-embed"
      data-url={block.link}
      onPress={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (block.link) {
          openUrl(block.link)
        }
      }}
    >
      {loading && (
        <div className="flex justify-center items-center">
          <Spinner />
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          display: 'flex',
          justifyContent: 'center',
          width: '100%',
        }}
      />
    </YStack>
  )
}

export function BlockContentCode({
  block,
  parentBlockId,
  ...props
}: BlockContentProps) {
  const {layoutUnit, debug, textUnit} = useDocContentContext()
  function getHighlightNodes(result: any) {
    return result.value || result.children || []
  }

  const CodeHighlight = ({node}: {node: any}) => {
    if (node.type === 'text') {
      return node.value
    }

    if (node.type === 'element') {
      const {tagName, properties, children} = node
      if (properties.className && Array.isArray(properties.className)) {
        properties.className = properties.className[0]
      }
      return createElement(
        tagName,
        {...properties},
        children &&
          children.map((child: any, index: number) => (
            <CodeHighlight key={index} node={child} />
          )),
      )
    }

    return null
  }
  const lowlight = useLowlight(common)
  const language =
    block.type === 'Code'
      ? getBlockAttribute(block.attributes, 'language')
      : null
  const nodes: any[] =
    language && language.length > 0
      ? getHighlightNodes(lowlight.highlight(language, block.text))
      : []

  return (
    <YStack
      {...props}
      borderColor="$color6"
      backgroundColor="$color4"
      borderWidth={1}
      borderRadius={layoutUnit / 4}
      className={cn(blockStyles)}
      padding={layoutUnit / 2}
      overflow="hidden"
      data-content-type="code"
      width="100%"
      {...debugStyles(debug, 'blue')}
      marginHorizontal={(-1 * layoutUnit) / 2}
    >
      <XStack
        tag="pre"
        className={'language-' + language}
        flex="unset"
        overflow="auto"
      >
        <Text
          tag="code"
          whiteSpace="pre"
          fontFamily="$mono"
          lineHeight={textUnit * 1.5}
          fontSize={textUnit * 0.85}
        >
          {nodes.length > 0
            ? nodes.map((node, index) => (
                <CodeHighlight key={index} node={node} />
              ))
            : block.text}
        </Text>
      </XStack>
    </YStack>
  )
}

export function BlockContentMath({
  block,
  parentBlockId,
  ...props
}: BlockContentProps) {
  const {layoutUnit} = useDocContentContext()
  const [tex, setTex] = useState<string>()
  const [error, setError] = useState<string>()
  const mathRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isContentSmallerThanContainer, setIsContentSmallerThanContainer] =
    useState(true)

  useEffect(() => {
    try {
      let res = katex.renderToString(block.text ? block.text : '', {
        throwOnError: true,
        displayMode: true,
      })
      setTex(res)
    } catch (e) {
      console.error(e)
      setError(e.message)
    }
  }, [block.text])

  // Function to measure content and container widths
  const measureContentAndContainer = useCallback(() => {
    if (mathRef.current && containerRef.current) {
      // Get the actual rendered content width from the first child of mathRef
      // (KaTeX creates nested elements)
      const contentElement = mathRef.current.firstElementChild as HTMLElement
      const contentWidth = contentElement
        ? contentElement.offsetWidth
        : mathRef.current.offsetWidth
      const containerWidth = containerRef.current.offsetWidth

      // Account for padding
      const paddingValue = layoutUnit / 2
      const adjustedContainerWidth = containerWidth - paddingValue * 2

      // Update state based on comparison
      const shouldCenter = contentWidth < adjustedContainerWidth
      if (shouldCenter !== isContentSmallerThanContainer) {
        setIsContentSmallerThanContainer(shouldCenter)
      }
    }
  }, [isContentSmallerThanContainer, layoutUnit])

  // Update measurements when tex changes
  useEffect(() => {
    if (tex) {
      // Use a timeout to ensure KaTeX has finished rendering
      const timerId = setTimeout(() => {
        measureContentAndContainer()
      }, 50)

      return () => clearTimeout(timerId)
    }
  }, [tex, measureContentAndContainer])

  // Also measure after mathRef updates (when KaTeX rendering is done)
  useEffect(() => {
    if (mathRef.current) {
      // Use MutationObserver to detect when KaTeX finishes rendering
      const observer = new MutationObserver(() => {
        measureContentAndContainer()
      })

      observer.observe(mathRef.current, {
        childList: true,
        subtree: true,
        attributes: true,
      })

      return () => {
        observer.disconnect()
      }
    }
  }, [measureContentAndContainer])

  // Add resize observer to handle container size changes
  useEffect(() => {
    const container = containerRef.current

    if (container) {
      const resizeObserver = new ResizeObserver(() => {
        measureContentAndContainer()
      })

      resizeObserver.observe(container)

      return () => {
        resizeObserver.disconnect()
      }
    }
  }, [measureContentAndContainer])

  if (error) {
    return <ErrorBlock message={error} />
  }

  return (
    <YStack
      {...props}
      className={cn('block-content block-katex', blockStyles)}
      paddingVertical="$3"
      gap="$2"
      ai={isContentSmallerThanContainer ? 'center' : 'flex-start'}
      width="100%"
      borderColor="$color6"
      backgroundColor="$color4"
      borderWidth={1}
      borderRadius={layoutUnit / 4}
      data-content-type="math"
      data-content={block.text}
      padding={layoutUnit / 2}
      overflow={isContentSmallerThanContainer ? 'hidden' : 'scroll'}
      marginHorizontal={(-1 * layoutUnit) / 2}
      ref={containerRef}
    >
      <SizableText
        ref={mathRef}
        ai={isContentSmallerThanContainer ? 'center' : 'flex-start'}
        ac={isContentSmallerThanContainer ? 'center' : 'flex-start'}
        dangerouslySetInnerHTML={{__html: tex}}
      />
    </YStack>
  )
}

function getSourceType(name?: string) {
  if (!name) return
  const nameArray = name.split('.')
  return `video/${nameArray[nameArray.length - 1]}`
}

function CheckboxWithLabel({
  size,
  label,
  ...checkboxProps
}: CheckboxProps & {size: SizeTokens; label: string}) {
  const id = `checkbox-${size.toString().slice(1)}`
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} size={size} {...checkboxProps}>
        <Checkbox.Indicator>
          <Check />
        </Checkbox.Indicator>
      </Checkbox>

      <Label size={size} htmlFor={id}>
        {label}
      </Label>
    </div>
  )
}

export function InlineEmbedButton({
  children,
  entityId,
  ...props
}: BlockContentProps & {
  children: string
  entityId: UnpackedHypermediaId
}) {
  const buttonProps = useRouteLink({key: 'document', id: entityId})
  return (
    <ButtonText
      {...buttonProps}
      onHoverIn={() => props.onHoverIn?.(entityId)}
      onHoverOut={() => props.onHoverOut?.(entityId)}
      textDecorationColor={'$brand5'}
      // style={{textDecorationLine: "underline"}}
      color="$brand5"
      fontWeight="bold"
      className="hm-link"
      fontSize="inherit"
      data-inline-embed={packHmId(entityId)}
      // this data attribute is used by the hypermedia highlight component
      data-blockid={entityId.blockRef}
      data-docid={entityId.blockRef ? undefined : entityId.id}
    >
      {children}
    </ButtonText>
  )
}

function RadioGroupItemWithLabel(props: {value: string; label: string}) {
  const id = `radiogroup-${props.value}`
  return (
    <div className="flex items-center gap-2">
      <RadioGroup.Item value={props.value} id={id} size="$1">
        <RadioGroup.Indicator />
      </RadioGroup.Item>

      <label className="text-xs" htmlFor={id}>
        {props.label}
      </label>
    </div>
  )
}

export function getBlockNode(
  blockNodes: HMBlockNode[] | undefined,
  blockId: string,
): HMBlockNode | null {
  if (!blockNodes) return null
  for (const node of blockNodes) {
    if (node.block.id === blockId) return node
    if (node.children) {
      const found = getBlockNode(node.children, blockId)
      if (found) return found
    }
  }
  return null
}
