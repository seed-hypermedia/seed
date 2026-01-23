import {
  BlockRange,
  HMAccountsMetadata,
  HMBlock,
  HMBlockButton,
  HMBlockChildrenType,
  HMBlockCode,
  HMBlockEmbed,
  HMBlockFile,
  HMBlockHeading,
  HMBlockImage,
  HMBlockMath,
  HMBlockNode,
  HMBlockParagraph,
  HMBlockQuery,
  HMBlockVideo,
  HMBlockWebEmbed,
  HMComment,
  HMContactRecord,
  HMDocument,
  HMDocumentInfo,
  HMEmbedView,
  HMInlineContent,
  HMResolvedResource,
  HMResourceFetchResult,
  UnpackedHypermediaId,
  clipContentBlocks,
  entityQueryPathToHmIdPath,
  formatBytes,
  formattedDateMedium,
  getChildrenType,
  getContactMetadata,
  getDocumentTitle,
  getMetadataName,
  hmBlockToEditorBlock,
  isHypermediaScheme,
  packHmId,
  queryBlockSortedItems,
  unpackHmId,
  useHover,
  useLowlight,
  useOpenRoute,
  useOpenUrl,
  useRangeSelection,
  useRouteLink,
  useRouteLinkHref,
  useUniversalAppContext,
  useUniversalClient,
} from '@shm/shared'
import {
  useAccountsMetadata,
  useDirectory,
  useResource,
  useResources,
} from '@shm/shared/models/entity'
import {useTxString} from '@shm/shared/translation'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {pluralS} from '@shm/shared/utils/language'
import {
  generateInstagramEmbedHtml,
  loadInstagramScript,
  loadTwitterScript,
} from '@shm/shared/utils/web-embed-scripts'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import {common} from 'lowlight'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  File,
  Link,
  MessageSquare,
  Undo2,
  X,
} from 'lucide-react'
import React, {
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
import {createPortal} from 'react-dom'
import {contentLayoutUnit, contentTextUnit} from './blocks-content-constants'
import './blocks-content.css'
import {Button} from './button'
import {CommentContent, Discussions} from './comments'
import {Badge} from './components/badge'
import {CheckboxField} from './components/checkbox'
import {RadioGroup, RadioGroupItem} from './components/radio-group'
import {EmbedWrapper} from './embed-wrapper'
import {BlankQueryBlockMessage} from './entity-card'
import {
  extractIpfsUrlCid,
  getDaemonFileUrl,
  isIpfsUrl,
  useFileUrl,
  useImageUrl,
} from './get-file-url'
import {SeedHeading, marginClasses} from './heading'
import {HMIcon} from './hm-icon'
import {HoverCard, HoverCardContent, HoverCardTrigger} from './hover-card'
import {BlockQuote} from './icons'
import {DocumentCard} from './newspaper'
import {QueryBlockContent} from './query-block-content'
import {Spinner} from './spinner'
import {SizableText, Text, TextProps} from './text'
import {Tooltip} from './tooltip'
import useMedia from './use-media'
import {cn} from './utils'

import {getCommentTargetId} from '@shm/shared'
import {HMCitation, HMResource} from '@shm/shared/hm-types'
import {toast} from 'sonner'
import {copyUrlToClipboardWithFeedback} from './copy-to-clipboard'
import {useHighlighter} from './highlight-context'
import {DocumentNameLink} from './inline-descriptor'
import {InlineError} from './inline-feedback'

export type BlockRangeSelectOptions = BlockRange & {
  copyToClipboard?: boolean
}

export type BlocksContentContextProps = {
  resourceId: UnpackedHypermediaId
  debugTop?: number
  ffSerif?: boolean
  contacts?: HMContactRecord[] | null
  commentStyle?: boolean
  onBlockSelect?:
    | ((blockId: string, opts?: BlockRangeSelectOptions) => void)
    | null
    | undefined
  onBlockCitationClick?: ((blockId?: string | null) => void) | undefined
  onBlockCommentClick?:
    | ((
        blockId?: string | null,

        blockRange?: BlockRange | undefined,
        startCommentingNow?: boolean,
      ) => void)
    | undefined
  blockCitations?: Record<string, {citations: number; comments: number}> | null
  openOnClick?: boolean
}

export type BlocksContentContextValue = BlocksContentContextProps & {
  layoutUnit: number
  textUnit: number
  saveCidAsFile?: (cid: string, name: string) => Promise<void>
  citations?: HMCitation[]
  debug: boolean
  collapsedBlocks: Set<string>
  setCollapsedBlocks: (id: string, val: boolean) => void
}

export type BlockContentProps<BlockType extends HMBlock = HMBlock> = {
  block: BlockType
  parentBlockId: string | null
  depth?: number
  style?: React.CSSProperties
}

export const blocksContentContext =
  createContext<BlocksContentContextValue | null>(null)

export function BlocksContentProvider({
  children,
  debugTop = 0,
  commentStyle = false,
  ...props
}: PropsWithChildren<
  BlocksContentContextProps & {
    layoutUnit?: number
    textUnit?: number
  }
>) {
  const {experiments, contacts, saveCidAsFile} = useUniversalAppContext()
  const parentCtx = useContext(blocksContentContext)
  // Priority: explicit props > parent context > defaults
  const layoutUnit =
    props.layoutUnit ?? parentCtx?.layoutUnit ?? contentLayoutUnit
  const textUnit = props.textUnit ?? parentCtx?.textUnit ?? contentTextUnit
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
  const showDevMenu = experiments?.pubContentDevMenu || false
  return (
    <blocksContentContext.Provider
      value={{
        ...props,
        layoutUnit: lUnit,
        textUnit: tUnit,
        debug,
        ffSerif,
        commentStyle,
        collapsedBlocks,
        setCollapsedBlocks,
        contacts,
        saveCidAsFile,
      }}
    >
      {children}
      {showDevMenu ? (
        <div className="hover:bg-background border-border dark:bg-background fixed right-16 bottom-16 z-50 flex flex-col gap-1 rounded-md border bg-white p-2">
          <CheckboxField
            checked={debug}
            // @ts-ignore
            onCheckedChange={setDebug}
            size="sm"
          >
            debug
          </CheckboxField>
          <CheckboxField
            checked={ffSerif}
            // @ts-ignore
            onCheckedChange={toggleSerif}
            size="sm"
          >
            body sans-serif
          </CheckboxField>
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
              {/* @ts-expect-error */}
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
    </blocksContentContext.Provider>
  )
}

export function useBlocksContentContext() {
  const ctx = useContext(blocksContentContext)
  if (!ctx) {
    throw new Error(
      'useBlocksContentContext must be used within a BlocksContentProvider',
    )
  }
  return ctx
}

export function useLayoutUnit() {
  const ctx = useContext(blocksContentContext)
  if (ctx) return ctx.layoutUnit
  return contentLayoutUnit
}

export function useContentResourceId(): UnpackedHypermediaId | null {
  const ctx = useContext(blocksContentContext)
  return ctx?.resourceId || null
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

export function BlocksContent({
  blocks,
  focusBlockId,
  maxBlockCount,
  hideCollapseButtons = false,
  allowHighlight = true,
  ...props
}: {
  blocks: HMBlockNode[]
  focusBlockId?: string | undefined
  maxBlockCount?: number
  marginVertical?: any
  hideCollapseButtons?: boolean
  allowHighlight?: boolean
}) {
  const media = useMedia()
  const {wrapper, bubble, coords, state, actor} = useRangeSelection(blocks)
  const {layoutUnit, onBlockSelect} = useBlocksContentContext()
  const focusedBlocks = getFocusedBlocks(blocks, focusBlockId)
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
      className="relative my-2"
      ref={wrapper}
      style={{
        paddingLeft: layoutUnit / 3,
        paddingRight: layoutUnit / 3,
      }}
      {...props}
    >
      <div
        ref={bubble}
        className={cn(
          'absolute top-0 left-0 z-50 transition-[opacity,transform] duration-200 ease-out select-none',
          media.gtSm &&
            !state.matches('disable') &&
            state.matches({active: 'selected'})
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-4 opacity-0',
        )}
        style={{...coords}}
      >
        {onBlockSelect ? (
          <Tooltip content={tx('copy_block_range', 'Copy Block Range')}>
            <Button
              size="icon"
              className="bg-background hover:bg-background border-border relative border dark:bg-black dark:hover:bg-black"
              onClick={() => {
                onBlockSelect(
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
                // Clear the browser selection so custom highlight becomes visible
                actor.send({type: 'CREATE_COMMENT'})
              }}
            >
              <Link className="size-3" size={2} />
            </Button>
          </Tooltip>
        ) : null}
      </div>
      <BlocksContentInner
        blocks={displayBlocks}
        parentBlockId={null}
        hideCollapseButtons={hideCollapseButtons}
      />
    </div>
  )
}
const BlocksContentInner = memo(_BlocksContent)

function _BlocksContent({
  blocks,
  parentBlockId,
  hideCollapseButtons = false,
  expanded = true,
}: {
  blocks?: Array<HMBlockNode> | null
  parentBlockId: string | null
  hideCollapseButtons?: boolean
  expanded?: boolean
}) {
  const {onBlockSelect, resourceId} = useBlocksContentContext()

  const createBlockClickHandler = (blockId: string) => () => {
    const windowSelection = window.getSelection()
    const hasSelection =
      windowSelection && windowSelection.toString().length > 0

    if (!hasSelection && onBlockSelect) {
      const isCurrentlyFocused = resourceId.blockRef === blockId
      if (isCurrentlyFocused) {
        onBlockSelect('', {expanded: true, copyToClipboard: false})
      } else {
        onBlockSelect(blockId, {expanded: true, copyToClipboard: false})
      }
    }
  }

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
                // @ts-expect-error
                bn.block?.attributes,
                'childrenType',
              )}
              listLevel={1}
              index={idx}
              expanded={expanded}
              handleBlockClick={
                bn.block?.id ? createBlockClickHandler(bn.block.id) : undefined
              }
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
    // @ts-ignore
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
      classes.push('pl-3')
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
  embedDepth,
  embedId,
  parentBlockId,
  hideCollapseButtons = false,
  handleBlockClick,
  allowHighlight = true,
}: {
  isFirstChild: boolean
  blockNode: HMBlockNode
  index: number
  depth?: number
  listLevel?: number
  childrenType?: HMBlockChildrenType
  embedDepth?: number
  embedId?: string
  expanded?: boolean
  parentBlockId: string | null
  hideCollapseButtons?: boolean
  handleBlockClick?: () => void
  allowHighlight?: boolean
}) {
  const {
    layoutUnit,
    onBlockCitationClick,
    onBlockCommentClick,
    onBlockSelect,
    debug,
    blockCitations,
    setCollapsedBlocks,
    resourceId,
  } = useBlocksContentContext()
  const [hover, setHover] = useState(false)
  const isHighlight =
    allowHighlight &&
    resourceId.blockRef == blockNode.block?.id &&
    resourceId.blockRange?.start == undefined
  const headingMarginStyles = useHeadingMarginStyles(
    depth,
    layoutUnit,
    isFirstChild,
  )

  const media = useMedia()

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

  const createChildBlockClickHandler = (blockId: string) => () => {
    const windowSelection = window.getSelection()
    const hasSelection =
      windowSelection && windowSelection.toString().length > 0

    if (!hasSelection && onBlockSelect) {
      const isCurrentlyFocused = resourceId.blockRef === blockId
      if (isCurrentlyFocused) {
        onBlockSelect('', {expanded: true, copyToClipboard: false})
      } else {
        onBlockSelect(blockId, {expanded: true, copyToClipboard: false})
      }
    }
  }

  let bnChildren = blockNode.children?.length
    ? blockNode.children.map((bn: HMBlockNode, index: number) => {
        if (!bn.block) return null
        const bnChildrenType = getChildrenType(bn.block)
        return (
          <BlockNodeContent
            hideCollapseButtons={hideCollapseButtons}
            key={bn.block.id}
            depth={depth + 1}
            isFirstChild={index == 0}
            blockNode={bn}
            childrenType={bnChildrenType}
            listLevel={
              childrenType === 'Unordered' && bnChildrenType === 'Unordered'
                ? listLevel + 1
                : listLevel
            }
            index={index}
            parentBlockId={blockNode.block?.id || null}
            embedDepth={embedDepth ? embedDepth + 1 : embedDepth}
            expanded={_expanded}
            handleBlockClick={
              bn.block.id
                ? createChildBlockClickHandler(bn.block.id)
                : undefined
            }
          />
        )
      })
    : null

  const headingStyles = useMemo(() => {
    if (blockNode.block?.type == 'Heading') {
      return headingMarginStyles
    }

    return {}
  }, [blockNode.block, headingMarginStyles])

  const isEmbed = blockNode.block?.type == 'Embed'

  // Clone block and add the highlight annotation
  const blockWithHighlights = useMemo(() => {
    if (!(resourceId.blockRef === blockNode.block?.id && resourceId.blockRange))
      return blockNode.block

    const clonedBlock: HMBlock = {
      ...blockNode.block,
      // @ts-expect-error
      annotations: [...(blockNode!.block!.annotations || [])],
    }

    // Add the highlight annotation
    // @ts-expect-error
    clonedBlock.annotations.push({
      type: 'Range',
      starts: [resourceId.blockRange.start],
      ends: [resourceId.blockRange.end],
      attributes: {},
    })

    return clonedBlock
  }, [blockNode.block, resourceId])

  function handleBlockNodeToggle() {
    setExpanded(!_expanded)
    if (embedId) setCollapsedBlocks(embedId, !_expanded)
  }

  const tx = useTxString()

  const hoverCardContent = (
    <div className="flex">
      {citationsCount?.citations ? (
        <BubbleButton
          layoutUnit={layoutUnit}
          tooltip={tx(
            'block_citation_count',
            ({count}) =>
              `${count} ${pluralS(count, 'document')} citing this block`,
            {count: citationsCount.citations},
          )}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onBlockCitationClick?.(blockNode.block?.id)
          }}
        >
          <BlockQuote color="currentColor" className="size-3 opacity-50" />
          {citationsCount.citations ? (
            <SizableText color="muted" size="xs">
              {String(citationsCount.citations)}
            </SizableText>
          ) : undefined}
        </BubbleButton>
      ) : null}

      {onBlockCommentClick ? (
        <BubbleButton
          layoutUnit={layoutUnit}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (blockNode.block?.id) {
              onBlockCommentClick(
                blockNode.block.id,
                undefined,
                citationsCount?.comments ? false : true, // start commenting now if no comments, otherwise just open
              )
            } else {
              console.error('onBlockCommentClick Error: no blockId available')
            }
          }}
          tooltip={
            media.gtSm
              ? citationsCount?.comments
                ? tx(
                    'block_comment_count',
                    ({count}) => `${count} ${pluralS(count, 'comment')}`,
                    {count: citationsCount.comments},
                  )
                : tx('Comment on this block')
              : ''
          }
        >
          <MessageSquare color="currentColor" className="size-3 opacity-50" />
          {citationsCount?.comments ? (
            <SizableText color="muted" size="xs">
              {String(citationsCount.comments)}
            </SizableText>
          ) : undefined}
        </BubbleButton>
      ) : null}
      {onBlockSelect ? (
        <BubbleButton
          tooltip={
            media.gtSm
              ? tx('copy_block_exact', 'Copy Block Link (Exact Version)')
              : ''
          }
          layoutUnit={layoutUnit}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (blockNode.block?.id) {
              onBlockSelect(blockNode.block.id, {
                expanded: true,
                copyToClipboard: true,
              })
            } else {
              console.error('onBlockSelect Error: no blockId available')
            }
          }}
        >
          <Link color="currentColor" className="size-3 opacity-50" />
        </BubbleButton>
      ) : null}
    </div>
  )

  const blockCitationCount =
    (citationsCount?.citations || 0) + (citationsCount?.comments || 0)

  const handleClick = (e: React.MouseEvent) => {
    if (handleBlockClick) {
      e.stopPropagation()
      handleBlockClick()
    }
  }

  const highlighter = useHighlighter()

  return (
    <div
      id={blockNode.block?.id}
      ref={elm}
      data-node-type="blockContainer"
      data-block-type={blockNode.block?.type}
      className={cn(
        'blocknode-content',
        isHighlight ? 'bg-brand-12' : 'bg-transparent',
        hover && !isHighlight && 'bg-background',
      )}
      style={{
        borderRadius: layoutUnit / 4,
        boxShadow: isHighlight ? '0 0 0 1px var(--brand-10)' : 'none',
      }}
      onClick={handleClick}
    >
      <div
        style={{
          borderRadius: layoutUnit / 4,
          padding: layoutUnit / 3,
          paddingTop: isEmbed ? 0 : layoutUnit / 6,
          paddingBottom: isEmbed ? 0 : layoutUnit / 6,
        }}
        {...debugStyles(debug, 'red')}
        className={cn(
          blockNode.block!.type == 'Heading' && 'blocknode-content-heading',
          // @ts-expect-error
          headingStyles.className,
        )}
        onMouseEnter={embedDepth ? undefined : () => setHover(true)}
        onMouseLeave={embedDepth ? undefined : () => setHover(false)}
      >
        <div className="relative">
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
                size="iconSm"
                variant="ghost"
                data-block-type={blockNode.block?.type}
                data-depth={depth}
                className={cn(
                  'bg-background hover:bg-background border-border absolute left-[-32px] z-20 size-5 border p-0 opacity-0 select-none hover:opacity-100 dark:hover:bg-black',
                  hover
                    ? 'opacity-100'
                    : _expanded
                    ? 'opacity-0'
                    : 'opacity-100',
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  handleBlockNodeToggle()
                }}
              >
                {_expanded ? (
                  <ChevronDown size={12} className="size-3" />
                ) : (
                  <ChevronRight size={12} className="size-3" />
                )}
              </Button>
            </Tooltip>
          ) : null}
          <div {...highlighter({...resourceId, blockRef: blockNode.block?.id})}>
            {media.gtSm ? (
              <HoverCard
                openDelay={500}
                closeDelay={500}
                open={isHighlight || undefined}
              >
                <HoverCardTrigger asChild>
                  <div>
                    <BlockContent
                      block={blockWithHighlights}
                      depth={depth}
                      parentBlockId={parentBlockId}
                      // {...interactiveProps}
                    />
                  </div>
                </HoverCardTrigger>
                <HoverCardContent
                  side="top"
                  align="end"
                  className="z-10 w-auto p-0"
                >
                  {hoverCardContent}
                </HoverCardContent>
              </HoverCard>
            ) : (
              <>
                {isHighlight ? (
                  <div className="bg-popover text-popover-foreground absolute top-0 right-0 z-10 -translate-y-[90%] rounded-md border shadow-md outline-hidden">
                    {hoverCardContent}
                  </div>
                ) : undefined}
                <BlockContent
                  block={blockWithHighlights}
                  depth={depth}
                  parentBlockId={parentBlockId}
                  // {...interactiveProps}
                />
              </>
            )}
          </div>
          {embedDepth
            ? null
            : blockCitationCount > 0 && (
                <div
                  className={cn(
                    'absolute top-0 right-[-18px] flex flex-col gap-2 pl-4',
                    hover && 'z-30',
                  )}
                  style={{
                    borderRadius: layoutUnit / 4,
                  }}
                  onMouseEnter={() => setHover(true)}
                  onMouseLeave={() => setHover(false)}
                >
                  {media.gtSm ? (
                    <HoverCard openDelay={0}>
                      <HoverCardTrigger>
                        <Badge
                          onClick={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            if (blockNode.block?.id) {
                              onBlockCommentClick?.(
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
                          variant="outline"
                        >
                          {blockCitationCount}
                        </Badge>
                      </HoverCardTrigger>
                      <HoverCardContent
                        side="top"
                        align="end"
                        className="z-10 w-auto p-0"
                      >
                        {hoverCardContent}
                      </HoverCardContent>
                    </HoverCard>
                  ) : (
                    <Badge
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        if (blockNode.block?.id) {
                          onBlockCommentClick?.(
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
                      variant="outline"
                      className="cursor-pointer"
                    >
                      {blockCitationCount}
                    </Badge>
                  )}
                </div>
              )}
        </div>
      </div>
      {bnChildren && _expanded ? (
        <BlockNodeList
          // @ts-expect-error
          childrenType={blockNode.block?.attributes?.childrenType}
          listLevel={listLevel}
        >
          {bnChildren}
        </BlockNodeList>
      ) : null}
    </div>
  )
}

export const blockStyles = 'w-full flex-1 self-center'

function BlockContent(props: BlockContentProps) {
  const dataProps = {
    depth: props.depth || 1,
    'data-blockid': props.block.id,
  }
  const {openOnClick} = useBlocksContentContext()

  if (props.block.type == 'Paragraph') {
    return (
      <BlockContentParagraph {...props} {...dataProps} block={props.block} />
    )
  }

  if (props.block.type == 'Heading') {
    return <BlockContentHeading {...props} {...dataProps} block={props.block} />
  }

  if (props.block.type == 'Image') {
    return <BlockContentImage {...props} {...dataProps} block={props.block} />
  }

  if (props.block.type == 'Video') {
    return <BlockContentVideo {...props} {...dataProps} block={props.block} />
  }

  // if (props.block.type == "nostr") {
  //   return <BlockContentNostr {...props} {...dataProps} />;
  // }

  if (props.block.type == 'File') {
    return <BlockContentFile {...props} {...dataProps} block={props.block} />
  }

  if (props.block.type == 'Button') {
    return <BlockContentButton {...props} {...dataProps} block={props.block} />
  }

  if (props.block.type == 'WebEmbed') {
    return (
      <BlockContentWebEmbed {...props} {...dataProps} block={props.block} />
    )
  }

  if (props.block.type == 'Embed') {
    const embedBlock = props.block
    if (props.block.attributes.view === 'Card')
      return (
        <BlockEmbedCard
          {...props}
          {...dataProps}
          block={embedBlock}
          openOnClick={openOnClick}
        />
      )
    if (props.block.attributes.view === 'Comments') {
      return (
        <BlockEmbedComments
          {...props}
          {...dataProps}
          block={embedBlock}
          openOnClick={openOnClick}
        />
      )
    }
    // if (props.block.attributes.view === 'Content') // content is the default
    return (
      <BlockEmbedContent
        {...props}
        {...dataProps}
        block={embedBlock}
        openOnClick={openOnClick}
      />
    )
  }

  if (props.block.type == 'Code') {
    return <BlockContentCode {...props} {...dataProps} block={props.block} />
  }

  if (props.block.type == 'Math') {
    return <BlockContentMath {...props} {...dataProps} block={props.block} />
  }

  if (props.block.type == 'Query') {
    return <BlockContentQuery {...props} {...dataProps} block={props.block} />
  }

  return <BlockContentUnknown {...props} />
}

function BlockContentParagraph({
  block,
  parentBlockId,
  ...props
}: BlockContentProps<HMBlockParagraph>) {
  const {debug, commentStyle} = useBlocksContentContext()

  let inline = useMemo(() => {
    const editorBlock = hmBlockToEditorBlock(block)
    return editorBlock?.content ?? []
  }, [block])
  return (
    <Text
      {...props}
      {...debugStyles(debug, 'blue')}
      className={cn(
        'block-content block-paragraph content-inline break-words',
        commentStyle && 'is-comment',
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
}: BlockContentProps<HMBlockHeading>) {
  const {debug} = useBlocksContentContext()
  let inline = useMemo(
    () => hmBlockToEditorBlock(block)?.content ?? [],
    [block],
  )

  return (
    <SeedHeading
      {...props}
      {...debugStyles(debug, 'blue')}
      level={depth as 1 | 2 | 3 | 4 | undefined}
      className={cn('block-content block-heading max-w-[95%]', blockStyles)}
    >
      <InlineContentView inline={inline} fontWeight="bold" fontSize={null} />
    </SeedHeading>
  )
}

export function useHeadingMarginStyles(
  depth: number,
  // @ts-ignore
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
}: BlockContentProps<HMBlockImage>) {
  let inline = useMemo(
    () => hmBlockToEditorBlock(block)?.content ?? [],
    [block],
  )
  const {textUnit} = useBlocksContentContext()
  const imageUrl = useImageUrl()
  const [modalState, setModalState] = useState<'closed' | 'opening' | 'open'>(
    'closed',
  )
  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  if (!block?.link) return null

  const handleDoubleClick = useCallback(() => {
    setModalState('opening')
  }, [])

  const handleClose = useCallback(() => {
    setModalState('closed')
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalState === 'open') {
        handleClose()
      }
    },
    [modalState, handleClose],
  )

  const handleAnimationEnd = useCallback(() => {
    if (modalState === 'opening') {
      setModalState('open')
    }
  }, [modalState])

  useEffect(() => {
    if (modalState !== 'closed') {
      document.addEventListener('keydown', handleKeyDown)
      // document.body.style.overflow = 'hidden'
    } else {
      document.removeEventListener('keydown', handleKeyDown)
      // document.body.style.overflow = 'auto'
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      // document.body.style.overflow = 'auto'
    }
  }, [modalState, handleKeyDown])

  const maximizedContent = modalState !== 'closed' && (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm',
        modalState === 'opening' ? 'animate-in fade-in duration-300' : '',
      )}
      onClick={handleClose}
    >
      <div
        className="relative flex size-full items-center justify-center"
        onClick={(e) => {
          e.stopPropagation()
          handleClose()
        }}
      >
        <img
          alt={block?.attributes?.name}
          src={imageUrl(block?.link, 'L')}
          className={cn(
            'object-contain',
            modalState === 'opening'
              ? 'animate-in zoom-in-50 duration-300'
              : '',
          )}
          style={{
            maxWidth: '90vw',
            maxHeight: '90vh',
            width: '100%',
            height: '100%',
          }}
          onAnimationEnd={handleAnimationEnd}
        />
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
          aria-label="Close"
        >
          <X size={20} />
        </button>
      </div>
    </div>
  )

  return (
    <>
      <div
        {...props}
        ref={containerRef}
        className={cn(
          'block-content block-image flex w-full max-w-full flex-col items-center gap-2 py-3',
          blockStyles,
        )}
        data-content-type="image"
        data-url={block?.link}
        data-name={block?.attributes?.name}
        data-width={getBlockAttribute(block.attributes, 'width')}
      >
        <div
          className={cn('max-w-full cursor-pointer')}
          style={{
            maxWidth: getBlockAttribute(block.attributes, 'width')
              ? `${getBlockAttribute(block.attributes, 'width')}px`
              : undefined,
          }}
          onClick={handleDoubleClick}
          title="Click to maximize"
        >
          <img
            ref={imageRef}
            alt={block?.attributes?.name}
            src={imageUrl(block?.link, 'L')}
            style={{
              width: '100%',
              maxHeight: '600px',
              objectFit: 'contain',
              transition: 'transform 0.2s ease-out',
            }}
            onClick={() => {
              handleDoubleClick()
            }}
            className="transition-transform duration-200"
          />
        </div>
        <p>
          {inline.length ? (
            <InlineContentView
              inline={inline}
              fontSize={textUnit * 0.85}
              className="text-muted-foreground"
            />
          ) : null}
        </p>
      </div>
      {typeof window !== 'undefined' &&
        (() => {
          return createPortal(maximizedContent, document.body)
        })()}
    </>
  )
}

function BlockContentVideo({
  block,
  parentBlockId,
  ...props
}: BlockContentProps<HMBlockVideo>) {
  let inline = useMemo(
    () => hmBlockToEditorBlock(block)?.content ?? [],
    [block],
  )
  const link = block.link || ''
  const {textUnit} = useBlocksContentContext()
  const fileUrl = useFileUrl()
  if (block.type !== 'Video') return null
  const isIpfs = isIpfsUrl(link)

  return (
    <div
      {...props}
      className={cn(
        'block-content block-video flex w-full max-w-full flex-col items-center gap-2 py-3',
        blockStyles,
      )}
      data-content-type="video"
      data-url={link}
      data-name={getBlockAttribute(block.attributes, 'name')}
      // @ts-expect-error
      position="relative"
      width="100%"
      ai="center"
    >
      {link ? (
        <div
          className={cn('relative aspect-video w-full max-w-full')}
          style={{
            width: getBlockAttribute(block.attributes, 'width')
              ? `${getBlockAttribute(block.attributes, 'width')}px`
              : '100%',
          }}
        >
          {isIpfs ? (
            <video
              className={cn('absolute top-0 left-0 h-full w-full')}
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
            <>
              <iframe
                className={cn('absolute top-0 left-0 h-full w-full')}
                src={getVideoIframeSrc(block.link)}
                allowFullScreen
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </>
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

function getInlineContentOffset(inline: HMInlineContent): number {
  if (inline.type === 'link') {
    return inline.content.map(getInlineContentOffset).reduce((a, b) => a + b, 0)
  }
  // @ts-expect-error
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
  const {textUnit} = useBlocksContentContext()

  let contentOffset = rangeOffset || 0
  const fSize = fontSize === null ? null : fontSize || textUnit

  const getLinkColor = (linkType: LinkType): string => {
    if (linkType == 'basic' || linkType == 'hypermedia')
      return 'text-link hover:text-link-hover'
    return ''
  }

  const buildStyleClasses = (styles: any): string => {
    const classes: string[] = []

    if (styles.bold) classes.push('font-bold')
    if (styles.italic) classes.push('italic')
    if (styles.code)
      classes.push(
        'text-code font-mono bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-[0.9em]',
      )
    if (styles.underline) classes.push('underline')
    if (styles.strike) classes.push('line-through')
    if (styles.range || isRange)
      classes.push('hm-embed-range bg-brand-10 hover:cursor-default')

    return classes.join(' ')
  }

  const buildTextDecorationStyle = (
    styles: any,
    linkType: LinkType,
  ): React.CSSProperties => {
    const decorations: string[] = []

    if (linkType || styles?.underline) decorations.push('underline')
    if (styles?.strike) decorations.push('line-through')

    return decorations.length > 0
      ? {
          textDecorationLine: decorations.join(' ') as any,
          textDecorationColor: 'currentColor',
        }
      : {}
  }

  const highlighter = useHighlighter()

  return (
    <>
      {inline.map((content, index) => {
        const inlineContentOffset = contentOffset
        contentOffset += getInlineContentOffset(content)

        const textDecorationStyle = buildTextDecorationStyle(
          // @ts-expect-error
          content.styles,
          linkType,
        )
        // Make code text smaller
        const actualFontSize =
          // @ts-expect-error
          fSize === null ? null : content.styles?.code ? fSize * 0.85 : fSize

        const dynamicStyles: React.CSSProperties = {
          lineHeight: 1.5,
          ...textDecorationStyle,
        }

        if (actualFontSize !== null) {
          dynamicStyles.fontSize = actualFontSize
        }

        if (content.type === 'text') {
          const styleClasses = buildStyleClasses(content.styles)

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
          const linkProps = useRouteLinkHref(content.href)
          const id = unpackHmId(content.href)
          return (
            <a
              key={index}
              {...linkProps}
              className={cn(
                'cursor-pointer break-all transition-colors',
                // link colors
                'link text-link hover:text-link-hover',
              )}
              target={isHmScheme ? undefined : '_blank'}
              {...highlighter(id)}
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
          // @ts-expect-error
          const hasRangeStyle = content.styles?.range || isRange
          const embedStyles = {
            ...dynamicStyles,
            ...(hasRangeStyle && {
              backgroundColor: 'var(--brand-10)',
            }),
          }
          if (unpackedRef)
            return <InlineEmbed entityId={unpackedRef} style={embedStyles} />
          else return <span>!?!</span>
        }

        // @ts-expect-error
        if (content.type === 'range') {
          return (
            <Text
              asChild
              key={index}
              className="bg-yellow-200/50 dark:bg-yellow-900/70"
            >
              <InlineContentView
                // @ts-expect-error
                inline={content.content}
                fontSize={fSize}
                rangeOffset={inlineContentOffset}
                isRange
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

export function BlockEmbedCard({
  block,
  parentBlockId,
  openOnClick = true,
}: BlockContentProps<HMBlockEmbed> & {openOnClick?: boolean}) {
  const id = unpackHmId(block.link) ?? undefined
  const doc = useResource(id, {subscribed: true})
  const document = doc.data?.type === 'document' ? doc.data.document : undefined
  const authors = useResources(
    document?.authors.map((uid: string) => hmId(uid)) || [],
  )
  if (doc.isInitialLoading)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  if (doc.data?.type === 'not-found') {
    if (doc.isDiscovering) {
      return (
        <div className="flex items-center justify-center gap-2 p-4">
          <Spinner className="size-4" />
          <SizableText className="text-muted-foreground">
            Looking for this content...
          </SizableText>
        </div>
      )
    }
    return <ErrorBlock message="Could not load embed" />
  }
  if (doc.data?.type === 'error') {
    return <ErrorBlock message={doc.data.message} />
  }
  if (doc.isError || !doc.data || doc.data.type == 'redirect')
    return <ErrorBlock message="Could not load embed" />

  const accountsMetadata = Object.fromEntries(
    authors
      .map((d: any) => d.data)
      .filter((d: any) => !!d)
      .map((authorDoc: any) => [
        authorDoc.id.uid,
        {
          id: authorDoc.id,
          metadata:
            authorDoc.type === 'document'
              ? authorDoc.document?.metadata
              : undefined,
        },
      ])
      .filter(([_, metadata]) => !!metadata),
  )

  if (!id) return <ErrorBlock message="Invalid Embed URL" />

  return (
    <EmbedWrapper
      id={id}
      parentBlockId={parentBlockId}
      hideBorder
      route={{key: 'document', id}}
      openOnClick={openOnClick}
    >
      <DocumentCard
        entity={{
          id,
          document: document,
        }}
        docId={id}
        accountsMetadata={accountsMetadata}
        navigate={false}
      />
    </EmbedWrapper>
  )
}

export function BlockEmbedContent({
  block,
  depth,
  parentBlockId,
  openOnClick = true,
}: BlockContentProps<HMBlockEmbed> & {openOnClick?: boolean}) {
  const resourceId = useContentResourceId()
  const [showReferenced, setShowReferenced] = useState(false)
  const id = unpackHmId(block.link)

  const isSelfEmbed =
    id &&
    resourceId &&
    resourceId.uid === id.uid &&
    resourceId.path?.join('/') === id.path?.join('/') &&
    id.latest

  const resource = useResource(id, {subscribed: true})
  const document =
    resource.data?.type === 'document' ? resource.data.document : undefined
  const comment =
    resource.data?.type === 'comment' ? resource.data.comment : undefined
  const commentTargetResource = useResource(getCommentTargetId(comment))

  const author = useResource(comment?.author ? hmId(comment?.author) : null)

  if (isSelfEmbed) {
    // this avoids a dangerous recursive embedding of the same document
    return (
      <ErrorBlock message="Cannot embed the latest version of a document within itself" />
    )
  }
  if (!id) return <ErrorBlock message="Invalid embed link" />
  if (resource.data?.type === 'not-found') {
    if (resource.isDiscovering) {
      return (
        <div className="block-content border-border bg-muted/30 flex items-center gap-2 rounded-md border p-4">
          <Spinner className="size-4" />
          <SizableText className="text-muted-foreground">
            Looking for this content...
          </SizableText>
        </div>
      )
    }
    return (
      <ErrorBlock message="Resource not found">
        <Button
          variant="destructive"
          onClick={() => {
            copyUrlToClipboardWithFeedback(block.link, 'Missing Resource')
          }}
        >
          Copy Link
        </Button>
      </ErrorBlock>
    )
  }
  if (resource.data?.type === 'tombstone') {
    return <ErrorBlock message="Resource has been deleted" />
  }
  if (resource.data?.type === 'error') {
    return <ErrorBlock message={resource.data.message} />
  }
  if (resource.isError || (!resource.isLoading && !resource.data)) {
    return <ErrorBlock message="Could not load embed" />
  }
  if (comment) {
    return (
      <BlockEmbedContentComment
        parentBlockId={parentBlockId}
        depth={depth}
        block={block}
        id={id}
        comment={comment}
        isLoading={resource.isLoading}
        targetResource={commentTargetResource.data ?? undefined}
        author={
          author.data?.type === 'document' || author.data?.type === 'comment'
            ? author.data
            : undefined
        }
        openOnClick={openOnClick}
      />
    )
  }

  return (
    <BlockEmbedContentDocument
      id={id}
      depth={depth}
      viewType={block.attributes?.view}
      blockId={block.id}
      blockRef={id.blockRef}
      blockRange={id.blockRange}
      isLoading={resource.isLoading}
      showReferenced={showReferenced}
      onShowReferenced={setShowReferenced}
      document={document}
      parentBlockId={parentBlockId}
      renderOpenButton={() => null}
      openOnClick={openOnClick}
    />
  )
}

export function BlockEmbedComments({
  parentBlockId,
  block,
  openOnClick = true,
}: BlockContentProps<HMBlockEmbed> & {openOnClick?: boolean}) {
  const client = useUniversalClient()
  const id = unpackHmId(block.link)

  useResource(id, {
    recursive: true,
    subscribed: true,
  })

  if (!id) {
    return <ErrorBlock message="Invalid embed link" />
  }

  const CommentEditor = client.CommentEditor

  return (
    <EmbedWrapper
      id={id}
      parentBlockId={parentBlockId}
      hideBorder
      openOnClick={openOnClick}
    >
      <Discussions
        commentEditor={
          CommentEditor ? (
            <div
              onClick={(e) => {
                e.stopPropagation()
              }}
            >
              <CommentEditor docId={id} />
            </div>
          ) : null
        }
        targetId={id}
      />
    </EmbedWrapper>
  )
}

export function ErrorBlock({
  message,
  debugData,
  children,
}: {
  message: string
  debugData?: any
  children?: React.ReactNode
}) {
  let [open, toggleOpen] = useState(false)
  return (
    <Tooltip
      content={debugData ? (open ? 'Hide debug Data' : 'Show debug data') : ''}
    >
      <div className="block-content block-unknown flex flex-1 flex-col">
        <div
          className="flex-start flex items-center gap-2 overflow-hidden rounded-md border border-red-300 bg-red-100 p-2"
          onClick={(e) => {
            e.stopPropagation()
            toggleOpen((v) => !v)
          }}
        >
          <SizableText color="destructive" className="font-sans text-sm">
            {message ? message : 'Error'}
          </SizableText>
          <AlertCircle color="danger" className="size-3" />
          {children}
        </div>
        {open ? (
          <pre className="border-border rounded-md border bg-gray-100 p-2 dark:bg-gray-800">
            <code className="font-mono text-xs wrap-break-word">
              {JSON.stringify(debugData, null, 4)}
            </code>
          </pre>
        ) : null}
      </div>
    </Tooltip>
  )
}

export function BlockEmbedContentComment({
  id,
  parentBlockId,
  depth,
  comment,
  author,
  block,
  targetResource,
  openOnClick = true,
}: {
  id: UnpackedHypermediaId
  parentBlockId: string | null
  depth: number | undefined
  block: HMBlockEmbed
  isLoading?: boolean
  comment: HMComment
  author: HMResolvedResource | null | undefined
  targetResource: HMResource | undefined
  openOnClick?: boolean
}) {
  return (
    <EmbedWrapper
      viewType={block.attributes?.view}
      depth={depth || 0}
      id={id}
      parentBlockId={parentBlockId || ''}
      openOnClick={openOnClick}
      route={{
        key: 'document',
        id: getCommentTargetId(comment)!,
        panel: {
          key: 'discussions',
          id,
          openComment: comment.id,
        },
      }}
    >
      {author && (
        <CommentEmbedHeader
          comment={comment}
          author={author}
          targetResource={targetResource}
        />
      )}
      <CommentContent
        comment={comment}
        zoomBlockRef={id.blockRef}
        allowHighlight={false}
        openOnClick={openOnClick}
      />
    </EmbedWrapper>
  )
}

function CommentEmbedHeader({
  comment,
  author,
  targetResource,
}: {
  comment: HMComment
  author: HMResolvedResource
  targetResource: HMResource | undefined
}) {
  const authorMetadata =
    author.type === 'document' ? author.document?.metadata : undefined
  return (
    <div className="flex flex-wrap justify-between p-3">
      <div className="flex items-center gap-2">
        {author.id && (
          <HMIcon
            size={24}
            id={author.id}
            name={authorMetadata?.name}
            icon={authorMetadata?.icon}
          />
        )}
        <SizableText weight="bold">{authorMetadata?.name || '?'}</SizableText>
        {targetResource && targetResource.type === 'document' ? (
          <>
            {' on '}
            <DocumentNameLink
              metadata={targetResource.document?.metadata}
              id={targetResource.id}
            />
          </>
        ) : null}
      </div>
      {comment.createTime ? (
        <SizableText size="sm" color="muted">
          {formattedDateMedium(comment.createTime)}
        </SizableText>
      ) : null}
    </div>
  )
}

function BlockEmbedContentDocument(props: {
  depth: number | undefined
  blockId: string
  blockRef: string | null
  blockRange: BlockRange | null
  isLoading: boolean
  id: UnpackedHypermediaId
  document: HMDocument | null | undefined
  showReferenced: boolean
  onShowReferenced: (showReference: boolean) => void
  renderOpenButton: () => React.ReactNode
  parentBlockId: string | null
  viewType?: HMEmbedView
  openOnClick?: boolean
}) {
  const {
    id,
    blockId,
    isLoading,
    document,
    showReferenced,
    onShowReferenced,
    renderOpenButton,
    parentBlockId,
    viewType,
    openOnClick,
  } = props
  const openRoute = useOpenRoute()

  const embedData = useMemo(() => {
    const selectedBlock =
      props.blockRef && document?.content
        ? getBlockNodeById(document.content, props.blockRef)
        : null

    // @ts-expect-error
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

  const embedOnBlockSelect = useCallback(
    (blockId: string, opts?: BlockRangeSelectOptions): boolean => {
      if (!openOnClick) return false
      if (opts?.copyToClipboard) {
        toast.error('Error: not implemented')
        return false
      }
      openRoute({
        key: 'document',
        id: {
          ...id,
          blockRef: blockId || null,
        },
      })
      return true
    },
    [openRoute, id],
  )

  let content: null | JSX.Element = <ErrorBlock message="Unknown error" />
  if (isLoading) {
    content = <Spinner />
  } else if (embedData.data.embedBlocks) {
    content = (
      <BlocksContentProvider onBlockSelect={embedOnBlockSelect} resourceId={id}>
        <BlockNodeList childrenType="Group">
          {!props.blockRef && document?.metadata?.name ? (
            <BlockNodeContent
              parentBlockId={props.parentBlockId}
              isFirstChild
              depth={props.depth}
              embedId={blockId}
              allowHighlight={false}
              blockNode={{
                block: {
                  type: 'Heading',
                  id: blockId,
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
              // @ts-expect-error
              <BlockNodeContent
                key={bn.block?.id}
                isFirstChild={
                  !props.blockRef && document?.metadata?.name ? true : idx == 0
                }
                depth={1}
                embedId={blockId}
                allowHighlight={false}
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
                size="sm"
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  onShowReferenced(false)
                }}
              >
                <Undo2 className="size-3" />
                Back to Reference
              </Button>
            </Tooltip>
          </div>
        ) : null}
      </BlocksContentProvider>
    )
  } else if (props.blockRef) {
    return (
      <ErrorBlock
        message={`Block #${props.blockRef} was not found in this version`}
      >
        <div className="flex gap-2 p-4">
          {id.version ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onShowReferenced(true)
              }}
            >
              Show Referenced Version
            </Button>
          ) : null}
          {renderOpenButton()}
        </div>
      </ErrorBlock>
    )
  }
  return (
    <EmbedWrapper
      route={{key: 'document', id}}
      viewType={viewType}
      depth={props.depth || 1}
      id={id}
      parentBlockId={parentBlockId || ''}
      isRange={
        !!props.blockRange &&
        ('start' in props.blockRange || 'end' in props.blockRange)
      }
      openOnClick={openOnClick}
    >
      {content}
    </EmbedWrapper>
  )
}

function BlockContentQuery({block}: {block: HMBlockQuery}) {
  const queryInclude = block.attributes.query.includes[0]
  const queryIncludeId = queryInclude
    ? hmId(queryInclude.space, {
        path: entityQueryPathToHmIdPath(queryInclude.path),
      })
    : null

  // Use shared hook for directory listing
  const directoryItems = useDirectory(queryIncludeId, {
    mode: queryInclude?.mode,
  })

  // Subscribe to query target
  const queryTarget = useResource(queryIncludeId, {
    recursive: true,
    subscribed: true,
  })

  // Apply sorting and limit
  const sortedItems = useMemo(() => {
    if (!directoryItems.data) return []
    const querySort = block.attributes.query.sort
    const sorted = querySort
      ? queryBlockSortedItems({entries: directoryItems.data, sort: querySort})
      : directoryItems.data
    const queryLimit = block.attributes.query.limit
    return queryLimit && queryLimit > 0 ? sorted.slice(0, queryLimit) : sorted
  }, [
    directoryItems.data,
    block.attributes.query.sort,
    block.attributes.query.limit,
  ])

  // Extract author IDs for metadata loading
  const authorIds = useMemo(() => {
    const ids = new Set<string>()
    sortedItems.forEach(
      (item) => item.authors?.forEach((authorId: string) => ids.add(authorId)),
    )
    return Array.from(ids)
  }, [sortedItems])

  // Batch load documents and authors
  const docIds = useMemo(
    () => sortedItems.map((item) => item.id),
    [sortedItems],
  )

  const documents = useResources([
    ...(docIds || []),
    ...authorIds.map((uid: string) => hmId(uid)),
  ])

  // Get accounts metadata
  const accountsMetadata = useAccountsMetadata(authorIds)

  // Show discovering state (after all hooks)
  if (queryTarget.data?.type === 'not-found' && queryTarget.isDiscovering) {
    return (
      <div className="border-border bg-muted/30 flex items-center gap-2 rounded-md border p-4">
        <Spinner className="size-4" />
        <SizableText className="text-muted-foreground">
          Looking for content...
        </SizableText>
      </div>
    )
  }

  if (queryTarget.data?.type === 'error') {
    return <ErrorBlock message={queryTarget.data.message} />
  }

  // Get entity helper function
  function getEntity(id: UnpackedHypermediaId) {
    return (
      documents?.find(
        (document: any) =>
          document.data?.id?.path?.join('/') === id.path?.join('/'),
      )?.data || null
    )
  }

  return (
    <QueryBlockContent
      items={sortedItems}
      style={block.attributes.style || 'Card'}
      columnCount={block.attributes.columnCount}
      banner={block.attributes.banner || false}
      accountsMetadata={accountsMetadata.data}
      getEntity={getEntity}
    />
  )
}

export function BlockContentUnknown(props: BlockContentProps<HMBlock>) {
  let message = `Unsupported Block: ${props.block.type}`
  if (props.block.type == 'Embed') {
    message = `Unsupported Embed: ${props.block.link}`
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

export function BlockContentFile({block}: BlockContentProps<HMBlockFile>) {
  const {saveCidAsFile} = useUniversalAppContext()
  const fileCid = block.link ? extractIpfsUrlCid(block.link) : ''
  const fileName = getBlockAttribute(block.attributes, 'name') || 'File'

  // Navigate to URL with filename parameter for web download
  const handleWebDownload = (e: React.MouseEvent) => {
    e.preventDefault()
    // Pass file name as a parameter
    const fileUrl = getDaemonFileUrl(fileCid, fileName)
    window.location.href = fileUrl
  }

  if (block.type !== 'File') return null
  return (
    <div
      data-content-type="file"
      data-url={block.link}
      data-name={fileName}
      data-size={getBlockAttribute(block.attributes, 'size')}
      className={cn(
        'block-content group block-file border-muted dark:border-muted relative overflow-hidden rounded-md border p-4',
      )}
    >
      <div className="relative flex w-full flex-1 items-center gap-2">
        <File size={18} className="flex-0" />
        <SizableText className="flex-1 truncate overflow-hidden text-sm whitespace-nowrap select-text">
          {fileName === 'File' ? 'Untitled File' : fileName}
        </SizableText>
        {getBlockAttribute(block.attributes, 'size') && (
          <SizableText color="muted" size="xs">
            {formatBytes(parseInt(getBlockAttribute(block.attributes, 'size')))}
          </SizableText>
        )}
      </div>
      {fileCid && (
        <Button
          variant="brand"
          className="absolute top-1/2 right-0 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100"
          size="sm"
          asChild
        >
          {saveCidAsFile ? (
            <a
              download
              onClick={() => {
                saveCidAsFile(fileCid, fileName)
              }}
            >
              Download
            </a>
          ) : (
            <a
              href={getDaemonFileUrl(fileCid, fileName)}
              onClick={handleWebDownload}
            >
              Download
            </a>
          )}
        </Button>
      )}
    </div>
  )
}

export function BlockContentButton({
  block,
  parentBlockId,
  ...props
}: BlockContentProps<HMBlockButton>) {
  const {hover, ...hoverProps} = useHover()
  const buttonLink = block.type === 'Button' ? block.link : null
  const linkProps = useRouteLinkHref(buttonLink || '')
  if (!block.attributes) {
    console.error('Button Block without attributes?!', block)
  }

  const alignment =
    getBlockAttribute(block.attributes, 'alignment') || 'flex-start'
  if (block.type !== 'Button') return null
  return (
    <div
      data-content-type="button"
      data-url={block.link}
      data-name={getBlockAttribute(block.attributes, 'name')}
      className="block-content block-button flex w-full max-w-full flex-col select-none"
      style={{
        justifyContent: alignment,
      }}
      {...props}
      {...hoverProps}
    >
      <Button
        variant="brand"
        size="lg"
        {...linkProps}
        className={cn(
          'w-auto! max-w-full justify-center border-none border-transparent text-center select-none',
          alignment === 'center'
            ? 'self-center'
            : alignment === 'flex-end'
            ? 'self-end'
            : 'self-start',
        )}
      >
        <SizableText
          size="lg"
          className="truncate text-center font-bold text-white"
        >
          {getBlockAttribute(block.attributes, 'name')}
        </SizableText>
      </Button>
    </div>
  )
}

export function BlockContentWebEmbed({
  block,
  parentBlockId,
  ...props
}: BlockContentProps<HMBlockWebEmbed>) {
  const layoutUnit = useLayoutUnit()
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
            // @ts-expect-error
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
    <div
      {...props}
      className={cn(
        'border-border bg-background w-full overflow-hidden rounded-md border p-4',
        'x-post-container',
        blockStyles,
      )}
      style={{
        padding: layoutUnit / 2,
        marginLeft: (-1 * layoutUnit) / 2,
        marginRight: (-1 * layoutUnit) / 2,
      }}
      data-content-type="web-embed"
      data-url={block.link}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (block.link) {
          openUrl(block.link)
        }
      }}
    >
      {loading && (
        <div className="flex items-center justify-center">
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
    </div>
  )
}

export function BlockContentCode({
  block,
  parentBlockId,
  ...props
}: BlockContentProps<HMBlockCode>) {
  const layoutUnit = useLayoutUnit()
  const language =
    block.type === 'Code'
      ? getBlockAttribute(block.attributes, 'language')
      : null

  // Handle mermaid code blocks specially
  if (language === 'mermaid') {
    return (
      <BlockContentMermaidCode
        block={block}
        parentBlockId={parentBlockId}
        {...props}
      />
    )
  }

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
  const nodes: any[] =
    language && language.length > 0
      ? getHighlightNodes(lowlight.highlight(language, block.text))
      : []

  return (
    <pre
      data-content-type="code"
      className={cn(
        blockStyles,
        `w-full overflow-auto rounded-md border language-${language} border-border bg-background`,
      )}
      style={
        {
          padding: layoutUnit / 2,
          marginLeft: (-1 * layoutUnit) / 2,
          marginRight: (-1 * layoutUnit) / 2,
        } as React.CSSProperties
      }
      {...props}
    >
      <code className="font-mono text-sm leading-relaxed whitespace-pre-wrap">
        {nodes.length > 0
          ? nodes.map((node, index) => (
              <CodeHighlight key={index} node={node} />
            ))
          : block.text}
      </code>
    </pre>
  )
}

// Render mermaid code blocks as diagrams
function BlockContentMermaidCode({
  block,
  parentBlockId,
  ...props
}: BlockContentProps<HMBlockCode>) {
  const {layoutUnit} = useBlocksContentContext()
  const [svgContent, setSvgContent] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [showCode, setShowCode] = useState(false)
  const mermaidRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const renderMermaid = async () => {
      if (!block.text) {
        setError(null)
        setSvgContent('')
        return
      }

      try {
        // Dynamic import to avoid SSR issues
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
        })

        const id = `mermaid-code-${block.id}-${Date.now()}`
        const {svg} = await mermaid.render(id, block.text)
        setSvgContent(svg)
        setError(null)
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'Invalid diagram'
        setError(errorMessage)
        setSvgContent('')
      }
    }

    renderMermaid()
  }, [block.text, block.id])

  return (
    <div
      {...props}
      data-content-type="code"
      data-language="mermaid"
      data-content={block.text}
      className={cn(
        'block-content block-code-mermaid bg-background border-border w-full gap-2 rounded-md border py-3',
        blockStyles,
      )}
      style={{
        padding: layoutUnit / 2,
        marginLeft: (-1 * layoutUnit) / 2,
        marginRight: (-1 * layoutUnit) / 2,
      }}
    >
      {error ? (
        <div className="w-full rounded-md bg-red-100 p-3 text-red-600 dark:bg-red-900/30 dark:text-red-400">
          <p className="font-mono text-sm">Mermaid Error: {error}</p>
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-red-50 p-2 text-xs dark:bg-red-950/50">
            <code>{block.text}</code>
          </pre>
        </div>
      ) : svgContent ? (
        <div className="flex w-full flex-col gap-2">
          <div
            ref={mermaidRef}
            className="mermaid-diagram flex w-full items-center justify-center overflow-auto"
            dangerouslySetInnerHTML={{__html: svgContent}}
          />
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowCode(!showCode)}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              {showCode ? 'Hide Code' : 'View Code'}
            </Button>
          </div>
          {showCode && (
            <pre className="bg-muted max-h-60 overflow-auto rounded-md p-3">
              <code className="font-mono text-sm">{block.text}</code>
            </pre>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground text-center">Empty Mermaid block</p>
      )}
    </div>
  )
}

export function BlockContentMath({
  block,
  parentBlockId,
  ...props
}: BlockContentProps<HMBlockMath>) {
  const {layoutUnit} = useBlocksContentContext()
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
    } catch (e: unknown) {
      console.error(e)
      setError((e as Error).message)
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
  // @ts-ignore
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
  // @ts-ignore
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
  // @ts-ignore
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
    <div
      {...props}
      data-content-type="math"
      data-content={block.text}
      ref={containerRef}
      className={cn(
        'block-content block-katex bg-background border-border w-full gap-2 rounded-md border py-3',
        blockStyles,
        isContentSmallerThanContainer ? 'items-center' : 'items-start',
        isContentSmallerThanContainer ? 'overflow-hidden' : 'overflow-scroll',
      )}
      style={{
        padding: layoutUnit / 2,
        marginLeft: (-1 * layoutUnit) / 2,
        marginRight: (-1 * layoutUnit) / 2,
      }}
    >
      <SizableText
        ref={mathRef}
        className={cn(
          isContentSmallerThanContainer
            ? 'items-center justify-center'
            : 'items-start justify-start',
        )}
        dangerouslySetInnerHTML={{__html: tex || ''}}
      />
    </div>
  )
}

function getSourceType(name?: string) {
  if (!name) return
  const nameArray = name.split('.')
  return `video/${nameArray[nameArray.length - 1]}`
}

export function InlineEmbedButton({
  children,
  entityId,
  style,
}: {
  children: React.ReactNode
  entityId: UnpackedHypermediaId
  style?: React.CSSProperties
}) {
  const highlighter = useHighlighter()
  const buttonProps = useRouteLink({key: 'document', id: entityId})
  const hasRangeHighlight = style?.backgroundColor === 'var(--brand-10)'
  return (
    <a
      {...buttonProps}
      {...highlighter(entityId)}
      className={cn(
        'text-link hover:text-link-hover font-bold',
        hasRangeHighlight && 'hm-embed-range bg-brand-10 hover:cursor-default',
      )}
      data-inline-embed={packHmId(entityId)}
      style={style}
    >
      {children}
    </a>
  )
}

function RadioGroupItemWithLabel(props: {value: string; label: string}) {
  const id = `radiogroup-${props.value}`
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem value={props.value} id={id} />
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

export function DocumentCardGrid({
  firstItem,
  items,
  getEntity,
  accountsMetadata,
  columnCount = 1,
}: {
  firstItem: HMDocumentInfo | undefined
  items: Array<HMDocumentInfo>
  getEntity: (id: UnpackedHypermediaId) => HMResourceFetchResult | null
  accountsMetadata: HMAccountsMetadata
  columnCount?: number
}) {
  const columnClasses = useMemo(() => {
    return cn(
      'basis-full',
      columnCount == 2 && 'sm:basis-1/2',
      columnCount == 3 && 'sm:basis-1/2 md:basis-1/3',
    )
  }, [columnCount])
  return (
    <div className="flex w-full flex-col">
      {firstItem ? (
        <div className="flex">
          <DocumentCard
            banner
            entity={getEntity(firstItem.id)}
            docId={firstItem.id}
            accountsMetadata={accountsMetadata}
          />
        </div>
      ) : null}
      {items?.length ? (
        <div className="-mx-3 mt-2 flex flex-wrap justify-center">
          {items.map((item) => {
            if (!item) return null
            return (
              <div className={cn(columnClasses, 'flex p-3')} key={item.id.id}>
                <DocumentCard
                  docId={item.id}
                  entity={getEntity(item.id)}
                  accountsMetadata={accountsMetadata}
                />
              </div>
            )
          })}
        </div>
      ) : null}
      {items.length == 0 ? (
        <BlankQueryBlockMessage message="No Documents found in this Query Block." />
      ) : null}
    </div>
  )
}

function BubbleButton({
  tooltip,
  layoutUnit,

  onClick,
  children,
}: {
  tooltip: string
  layoutUnit: number

  onClick: (e: React.MouseEvent) => void
  children: React.ReactNode
}) {
  let btn = (
    <Button
      size="icon"
      variant="ghost"
      className="rounded-sm select-none hover:opacity-100"
      style={{
        padding: layoutUnit / 4,
      }}
      onClick={onClick}
    >
      {children}
    </Button>
  )

  if (tooltip) {
    return (
      <Tooltip content={tooltip} delay={800}>
        {btn}
      </Tooltip>
    )
  } else {
    return btn
  }
}

function InlineEmbed({
  entityId,
  style,
}: {
  entityId: UnpackedHypermediaId
  style?: React.CSSProperties
}) {
  const doc = useResource(entityId, {subscribed: true})
  const ctx = useBlocksContentContext()
  const document = doc.data?.type === 'document' ? doc.data.document : undefined

  if (doc.isDiscovering) {
    return (
      <InlineEmbedButton entityId={entityId} style={style}>
        <Spinner size="small" />
      </InlineEmbedButton>
    )
  }

  if (doc.data?.type === 'not-found') {
    return (
      <InlineEmbedButton entityId={entityId} style={style}>
        <InlineError message="Could not find this content" />
      </InlineEmbedButton>
    )
  }

  if (doc.data?.type === 'error') {
    return (
      <InlineEmbedButton entityId={entityId} style={style}>
        <InlineError message={doc.data.message} />
      </InlineEmbedButton>
    )
  }

  let name = getMetadataName(document?.metadata) || '...'
  if (!entityId.path?.length) {
    const contactName = getContactMetadata(
      entityId.uid,
      document?.metadata,
      ctx?.contacts,
    ).name
    name = contactName
  }

  return (
    <InlineEmbedButton entityId={entityId} style={style}>
      {name}
    </InlineEmbedButton>
  )
}
