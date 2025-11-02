import {PlainMessage} from '@bufbuild/protobuf'
import {
  BlockRange,
  Contact,
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
  HMDocument,
  HMDocumentInfo,
  HMEmbedView,
  HMInlineContent,
  HMResolvedResource,
  UnpackedHypermediaId,
  clipContentBlocks,
  formatBytes,
  formattedDateMedium,
  getChildrenType,
  getDocumentTitle,
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
  useUniversalClient,
} from '@shm/shared'
import {
  BlockContentProps,
  BlockRangeSelectOptions,
  DocContentContextValue,
} from '@shm/shared/document-content-types'
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
import {Button} from './button'
import {Discussions} from './comments'
import {Badge} from './components/badge'
import {CheckboxField} from './components/checkbox'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from './components/popover'
import {RadioGroup, RadioGroupItem} from './components/radio-group'
import {contentLayoutUnit, contentTextUnit} from './document-content-constants'
import './document-content.css'
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

const defaultDocContentContext: DocContentContextValue = {
  onBlockSelect: null,
  layoutUnit: contentLayoutUnit,
  textUnit: contentTextUnit,
  debug: false,
  collapsedBlocks: new Set(),
  setCollapsedBlocks: () => {},
}

export const docContentContext = createContext<DocContentContextValue>(
  defaultDocContentContext,
)

export function DocContentProvider({
  children,
  debugTop = 0,
  showDevMenu = false,
  comment = false,
  routeParams = {},
  layoutUnit = contentLayoutUnit,
  textUnit = contentTextUnit,
  contacts,
  ...docContextContent
}: PropsWithChildren<
  DocContentContextValue & {
    debugTop?: number
    showDevMenu?: boolean
    ffSerif?: boolean
    contacts?: PlainMessage<Contact>[] | null
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
        textUnit: tUnit,
        debug,
        ffSerif,
        comment,
        routeParams,
        collapsedBlocks,
        setCollapsedBlocks,
        contacts,
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
    </docContentContext.Provider>
  )
}

export function useDocContentContext() {
  return useContext(docContentContext)
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
}: {
  document: HMDocument
  focusBlockId?: string | undefined
  maxBlockCount?: number
  marginVertical?: any
  handleBlockReplace?: () => boolean
}) {
  const media = useMedia()
  const allBlocks = document?.content || []
  const {wrapper, bubble, coords, state, actor} = useRangeSelection(allBlocks)
  const {layoutUnit, onBlockSelect} = useDocContentContext()
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
      className="relative my-6"
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
  blocks?: Array<HMBlockNode> | null
  parentBlockId: string | null
  handleBlockReplace?: () => boolean
  hideCollapseButtons?: boolean
  expanded?: boolean
}) {
  const {onBlockSelect, routeParams} = useDocContentContext()

  const createBlockClickHandler = (blockId: string) => () => {
    const selection = window.getSelection()
    const hasSelection = selection && selection.toString().length > 0

    if (!hasSelection && onBlockSelect) {
      const isCurrentlyFocused = routeParams?.blockRef === blockId
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
              handleBlockReplace={handleBlockReplace}
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
  handleBlockReplace,
  hideCollapseButtons = false,
  handleBlockClick,
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
  handleBlockReplace?: () => boolean
  hideCollapseButtons?: boolean
  handleBlockClick?: () => void
}) {
  const {
    layoutUnit,
    routeParams,
    onBlockCitationClick,
    onBlockCommentClick,
    onBlockSelect,
    debug,
    comment,
    blockCitations,
    setCollapsedBlocks,
  } = useDocContentContext()
  const [hover, setHover] = useState(false)
  const [isHighlight, setHighlight] = useState(false)
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
  const lastScrolledBlockRef = useRef<string | undefined>(undefined)

  const createChildBlockClickHandler = (blockId: string) => () => {
    const selection = window.getSelection()
    const hasSelection = selection && selection.toString().length > 0

    if (!hasSelection && onBlockSelect) {
      const isCurrentlyFocused = routeParams?.blockRef === blockId
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
            handleBlockReplace={handleBlockReplace}
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
    if (
      !(
        routeParams?.blockRef === blockNode.block?.id && routeParams?.blockRange
      )
    )
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
      // @ts-expect-error
      starts: [routeParams.blockRange.start],
      // @ts-expect-error
      ends: [routeParams.blockRange.end],
      attributes: {},
    })

    return clonedBlock
  }, [blockNode.block, routeParams?.blockRef, routeParams?.blockRange])

  useEffect(() => {
    let val =
      routeParams?.blockRef == blockNode.block?.id &&
      !comment &&
      !routeParams?.blockRange

    if (!routeParams?.blockRange || isHighlight) {
      setHighlight(val)
    }

    if (!val || !elm.current) return
    const container = document.querySelector('.base-doc-container')
    if (!container) return

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
    const handleClickOutside = (event: Event) => {
      if (elm.current && !elm.current.contains(event.target as Node)) {
        handleBlockReplace?.()
      }
    }

    // observer.observe(elm.current);
    container.addEventListener('click', handleClickOutside)

    // Remove listeners when unmounting
    return () => {
      // observer.disconnect();
      container.removeEventListener('click', handleClickOutside)
    }
  }, [routeParams?.blockRef, routeParams?.blockRange, comment, blockNode.block])

  function handleBlockNodeToggle() {
    setExpanded(!_expanded)
    if (embedId) setCollapsedBlocks(embedId, !_expanded)
  }

  useEffect(() => {
    if (elm.current) {
      if (
        !comment &&
        routeParams &&
        routeParams.blockRef === blockNode.block?.id &&
        lastScrolledBlockRef.current !== routeParams.blockRef
      ) {
        elm.current.scrollIntoView({behavior: 'smooth', block: 'start'})
        lastScrolledBlockRef.current = routeParams.blockRef
      }
    }
  }, [routeParams?.blockRef, comment, blockNode.block?.id])

  const tx = useTxString()

  // Mobile-friendly version without tooltips to avoid conflicts
  const mobileCardContent = !comment ? (
    <div className="flex">
      {citationsCount?.citations ? (
        <Button
          size="icon"
          variant="ghost"
          className="rounded-sm select-none hover:opacity-100"
          style={{
            padding: layoutUnit / 4,
            width: layoutUnit * 1.5,
            height: layoutUnit * 1.25,
          }}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onBlockCitationClick?.(blockNode.block?.id)
          }}
        >
          <BlockQuote color="currentColor" className="size-3 opacity-50" />
          <SizableText color="muted" size="xs">
            {citationsCount.citations
              ? String(citationsCount.citations)
              : undefined}
          </SizableText>
        </Button>
      ) : null}

      {onBlockCommentClick ? (
        <Button
          size="icon"
          variant="ghost"
          className="rounded-sm select-none hover:opacity-100"
          style={{
            padding: layoutUnit / 4,
            width: layoutUnit * 1.5,
            height: layoutUnit * 1.25,
          }}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (blockNode.block?.id) {
              onBlockCommentClick?.(blockNode.block?.id, undefined, true)
            } else {
              console.error('onBlockComment Error: no blockId available')
            }
          }}
        >
          <MessageSquare color="currentColor" className="size-3 opacity-50" />
        </Button>
      ) : null}

      {onBlockSelect ? (
        <Button
          size="icon"
          variant="ghost"
          className="rounded-sm select-none hover:opacity-100"
          style={{
            padding: layoutUnit / 4,
            width: layoutUnit * 1.5,
            height: layoutUnit * 1.25,
          }}
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
        </Button>
      ) : null}
    </div>
  ) : null

  const hoverCardContent = !comment ? (
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
          <SizableText color="muted" size="xs">
            {citationsCount.citations
              ? String(citationsCount.citations)
              : undefined}
          </SizableText>
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
            citationsCount?.comments
              ? tx(
                  'block_comment_count',
                  ({count}) => `${count} ${pluralS(count, 'comment')}`,
                  {count: citationsCount.comments},
                )
              : tx('Comment on this block')
          }
        >
          <MessageSquare color="currentColor" className="size-3 opacity-50" />
          <SizableText color="muted" size="xs">
            {citationsCount?.comments
              ? String(citationsCount.comments)
              : undefined}
          </SizableText>
        </BubbleButton>
      ) : null}
      {onBlockSelect ? (
        <BubbleButton
          tooltip={tx('copy_block_exact', 'Copy Block Link (Exact Version)')}
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
  ) : null

  const blockCitationCount =
    (citationsCount?.citations || 0) + (citationsCount?.comments || 0)

  const handleClick = (e: React.MouseEvent) => {
    if (handleBlockClick) {
      e.stopPropagation()
      handleBlockClick()
    }
  }

  return (
    <div
      id={blockNode.block?.id}
      ref={elm}
      data-node-type="blockContainer"
      data-block-type={blockNode.block?.type}
      className={cn(
        'blocknode-content',
        isHighlight ? 'bg-brand-12' : 'bg-transparent',
        !comment && hover && !isHighlight && 'bg-background',
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
          'relative',
          blockNode.block!.type == 'Heading' && 'blocknode-content-heading',
          // @ts-expect-error
          headingStyles.className,
        )}
        onMouseEnter={embedDepth ? undefined : () => setHover(true)}
        onMouseLeave={embedDepth ? undefined : () => setHover(false)}
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
              size="icon"
              variant="ghost"
              className={cn(
                'bg-background hover:bg-background border-border absolute left-[-24px] z-20 size-6 border p-0 opacity-0 select-none hover:opacity-100 dark:hover:bg-black',
                childrenType && ['Unordered', 'Ordered'].includes(childrenType)
                  ? 'top-2'
                  : 'top-4',
                hover ? 'opacity-100' : _expanded ? 'opacity-0' : 'opacity-100',
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
        {media.gtSm ? (
          <HoverCard openDelay={500} closeDelay={500}>
            <HoverCardTrigger>
              <BlockContent
                block={blockWithHighlights}
                depth={depth}
                parentBlockId={parentBlockId}
                // {...interactiveProps}
              />
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
          <Popover>
            <PopoverAnchor asChild>
              <div>
                <PopoverTrigger asChild>
                  <BlockContent
                    block={blockWithHighlights}
                    depth={depth}
                    parentBlockId={parentBlockId}
                    // {...interactiveProps}
                  />
                </PopoverTrigger>
              </div>
            </PopoverAnchor>
            <PopoverContent
              side="top"
              align="end"
              sideOffset={8}
              className="w-auto max-w-xs p-0"
            >
              {mobileCardContent}
            </PopoverContent>
          </Popover>
        )}
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
                      <Badge variant="outline">{blockCitationCount}</Badge>
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
                  <Popover>
                    <PopoverAnchor>
                      <PopoverTrigger asChild>
                        <Badge variant="outline" className="cursor-pointer">
                          {blockCitationCount}
                        </Badge>
                      </PopoverTrigger>
                    </PopoverAnchor>
                    <PopoverContent
                      side="left"
                      align="start"
                      sideOffset={8}
                      className="w-auto max-w-xs p-0"
                    >
                      {mobileCardContent}
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            )}
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
      return <BlockEmbedCard {...props} {...dataProps} block={embedBlock} />
    if (props.block.attributes.view === 'Comments')
      return <BlockEmbedComments {...props} {...dataProps} block={embedBlock} />
    // if (props.block.attributes.view === 'Content') // content is the default
    return <BlockEmbedContent {...props} {...dataProps} block={embedBlock} />
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
  const {debug, comment} = useDocContentContext()

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
}: BlockContentProps<HMBlockHeading>) {
  const {debug} = useDocContentContext()
  let inline = useMemo(() => hmBlockToEditorBlock(block).content, [block])

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
  let inline = useMemo(() => hmBlockToEditorBlock(block).content, [block])
  const {textUnit, comment} = useDocContentContext()
  const imageUrl = useImageUrl()
  const [modalState, setModalState] = useState<'closed' | 'opening' | 'open'>(
    'closed',
  )
  const [imageHeight, setImageHeight] = useState<number>(0)
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
          className={cn(
            'max-w-full cursor-pointer',
            comment &&
              imageHeight > 60 &&
              'max-h-[120px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%_-_30px),transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_calc(100%_-_30px),transparent_100%)]',
          )}
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
            onLoad={(e) => {
              const img = e.currentTarget
              setImageHeight(img.offsetHeight)
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
            <iframe
              className={cn('absolute top-0 left-0 h-full w-full')}
              src={getVideoIframeSrc(block.link)}
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
  const {textUnit, onHoverIn, onHoverOut} = useDocContentContext()

  let contentOffset = rangeOffset || 0
  const fSize = fontSize === null ? null : fontSize || textUnit

  const getLinkColor = (linkType: LinkType): string => {
    if (linkType == 'basic' || linkType == 'hypermedia')
      return 'text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300'
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
                'link text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300',
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
          // @ts-expect-error
          const hasRangeStyle = content.styles?.range || isRange
          const embedStyles = {
            ...dynamicStyles,
            ...(hasRangeStyle && {
              backgroundColor: 'var(--brand-10)',
            }),
          }
          if (unpackedRef)
            return (
              <InlineEmbedButton
                key={content.link}
                style={embedStyles}
                entityId={unpackedRef}
                block={{} as any}
                parentBlockId={null}
                onHoverIn={onHoverIn}
                onHoverOut={onHoverOut}
              >
                {`@${unpackedRef.uid}`}
              </InlineEmbedButton>
            )
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
}: BlockContentProps<HMBlockEmbed>) {
  const client = useUniversalClient()
  const id = unpackHmId(block.link) ?? undefined
  const doc = client.useResource(id)
  const document = doc.data?.type === 'document' ? doc.data.document : undefined
  const authors = client.useResources(
    document?.authors.map((uid: string) => hmId(uid)) || [],
  )

  if (doc.isInitialLoading)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  if (!doc.data) return <ErrorBlock message="Could not load embed" />

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
    <EmbedWrapper id={id} parentBlockId={parentBlockId} hideBorder>
      <DocumentCard
        entity={{
          id,
          document: document,
        }}
        docId={id}
        accountsMetadata={accountsMetadata}
      />
    </EmbedWrapper>
  )
}

export function BlockEmbedContent({
  block,
  depth,
  parentBlockId,
}: BlockContentProps<HMBlockEmbed>) {
  const client = useUniversalClient()
  const [showReferenced, setShowReferenced] = useState(false)
  const id = unpackHmId(block.link)
  const resource = client.useResource(id)
  const document =
    resource.data?.type === 'document' ? resource.data.document : undefined
  const comment =
    resource.data?.type === 'comment' ? resource.data.comment : undefined

  const author = client.useResource(
    comment?.author ? hmId(comment?.author) : null,
  )

  if (!id) return <ErrorBlock message="Invalid embed link" />

  if (comment) {
    return (
      <BlockEmbedContentComment
        parentBlockId={parentBlockId}
        depth={depth}
        block={block}
        id={id}
        comment={comment}
        isLoading={resource.isLoading}
        author={
          author.data?.type === 'document' || author.data?.type === 'comment'
            ? author.data
            : undefined
        }
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
    />
  )
}

export function BlockEmbedComments({
  parentBlockId,
  block,
}: BlockContentProps<HMBlockEmbed>) {
  const client = useUniversalClient()
  const id = unpackHmId(block.link)

  if (!id) {
    return <ErrorBlock message="Invalid embed link" />
  }

  const CommentEditor = client.CommentEditor

  return (
    <EmbedWrapper id={id} parentBlockId={parentBlockId} hideBorder noClick>
      <Discussions
        commentEditor={
          <div
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <CommentEditor docId={id} />
          </div>
        }
        targetId={id}
      />
    </EmbedWrapper>
  )
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
      <div className="block-content block-unknown flex flex-1 flex-col">
        <div
          className="flex-start flex gap-2 overflow-hidden rounded-md border border-red-300 bg-red-100 p-2"
          onClick={(e) => {
            e.stopPropagation()
            toggleOpen((v) => !v)
          }}
        >
          <SizableText color="destructive" className="font-sans text-sm">
            {message ? message : 'Error'}
          </SizableText>
          <AlertCircle color="danger" className="size-3" />
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
}: {
  id: UnpackedHypermediaId
  parentBlockId: string | null
  depth: number | undefined
  block: HMBlockEmbed
  isLoading?: boolean
  comment: HMComment | null | undefined
  author: HMResolvedResource | null | undefined
}) {
  const parentContext = useDocContentContext()
  const openRoute = useOpenRoute()

  // Create onBlockSelect handler for the comment embed that navigates to the comment with block focused
  const embedOnBlockSelect = useCallback(
    (blockId: string, options?: BlockRangeSelectOptions) => {
      if (options?.copyToClipboard) {
        return parentContext.onBlockSelect?.(blockId, options)
      }
      if (openRoute) {
        openRoute({
          key: 'document',
          id: {
            ...id,
            blockRef: blockId,
          },
        })
      }
    },
    [openRoute, id],
  )

  return (
    <EmbedWrapper
      viewType={block.attributes?.view}
      depth={depth || 0}
      id={id}
      parentBlockId={parentBlockId || ''}
    >
      <DocContentProvider
        {...parentContext}
        onBlockSelect={embedOnBlockSelect}
        routeParams={{}}
        citations={undefined}
        blockCitations={undefined}
      >
        {comment && author && (
          <CommentEmbedHeader comment={comment} author={author} />
        )}
        {comment?.content.map((bn, idx) => {
          return (
            <BlockNodeContent
              key={bn.block?.id}
              isFirstChild={idx == 0}
              depth={1}
              expanded={true}
              embedId={block.id}
              parentBlockId={parentBlockId}
              blockNode={bn}
              childrenType="Group"
              index={idx}
              embedDepth={1}
            />
          )
        })}
      </DocContentProvider>
    </EmbedWrapper>
  )
}

function CommentEmbedHeader({
  comment,
  author,
}: {
  comment: HMComment
  author: HMResolvedResource
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
}) {
  const {
    id,
    blockId,
    blockRange,
    isLoading,
    document,
    showReferenced,
    onShowReferenced,
    renderOpenButton,
    parentBlockId,
    viewType,
  } = props
  const parentContext = useDocContentContext()
  const openRoute = useOpenRoute()

  const [isExpanded, setExpanded] = useState(
    blockRange && 'expanded' in blockRange ? blockRange.expanded : true,
  )

  useEffect(() => {
    setExpanded(!parentContext.collapsedBlocks.has(blockId))
  }, [parentContext.collapsedBlocks, blockId])

  useEffect(() => {
    if (isExpanded === true && !parentContext.collapsedBlocks.has(blockId)) {
      parentContext.setCollapsedBlocks(blockId, false)
    }

    if (
      isExpanded === false &&
      parentContext.collapsedBlocks.has(blockId) === false
    ) {
      parentContext.setCollapsedBlocks(blockId, true)
    }
  }, [isExpanded, blockId])

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
    (blockId: string, opts?: BlockRangeSelectOptions) => {
      if (opts?.copyToClipboard) {
        return parentContext.onBlockSelect?.(blockId, opts)
      }
      if (openRoute) {
        openRoute({
          key: 'document',
          id: {
            ...id,
            blockRef: blockId || null,
          },
        })
      }
    },
    [openRoute, id],
  )

  let content: null | JSX.Element = <ErrorBlock message="Unknown error" />
  if (isLoading) {
    content = null
  } else if (embedData.data.embedBlocks) {
    content = (
      <DocContentProvider
        {...parentContext}
        onBlockSelect={embedOnBlockSelect}
        routeParams={{}}
        citations={undefined}
        onBlockCommentClick={null}
        blockCitations={undefined}
      >
        <BlockNodeList childrenType="Group">
          {!props.blockRef && document?.metadata?.name ? (
            <BlockNodeContent
              parentBlockId={props.parentBlockId}
              isFirstChild
              depth={props.depth}
              expanded={isExpanded}
              embedId={blockId}
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
                expanded={isExpanded}
                embedId={blockId}
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
      </DocContentProvider>
    )
  } else if (props.blockRef) {
    return (
      <BlockNotFoundError
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
      </BlockNotFoundError>
    )
  }
  return (
    <EmbedWrapper
      viewType={viewType}
      depth={props.depth || 1}
      id={id}
      parentBlockId={parentBlockId || ''}
      isRange={
        !!props.blockRange &&
        ('start' in props.blockRange || 'end' in props.blockRange)
      }
    >
      {content}
    </EmbedWrapper>
  )
}

function QueryBlock({
  id,
  block,
}: {
  id: UnpackedHypermediaId
  block: HMBlockQuery
}) {
  const client = useUniversalClient()
  const ctx = useDocContentContext()
  const {supportQueries, supportDocuments} = ctx || {}

  // Check if we have SSR context (web platform)
  const hasSSRContext = supportQueries && supportDocuments

  // Desktop: use client.useDirectory() for directory listing
  const directoryItems = hasSSRContext
    ? null
    : client.useDirectory(id, {mode: block.attributes.query.includes[0]?.mode})

  // Desktop: subscribe to query target when using directory
  if (directoryItems) {
    client.useResource(id, {recursive: true})
  }

  // Compute sorted items based on data source
  const sortedItems = useMemo(() => {
    let items: any[] = []

    if (hasSSRContext) {
      // Web: get items from SSR context
      const includes = block.attributes.query.includes || []
      if (includes.length === 0) return []
      const queryInclude = includes[0]
      if (!queryInclude?.space) return []

      const queryResults = supportQueries?.find((q: any) => {
        if (q.in.uid !== queryInclude.space) return false
        return true
      })

      items = queryResults?.results || []
    } else {
      // Desktop: get items from directory listing
      items = directoryItems?.data || []
    }

    // Sort and limit items
    const sorted = queryBlockSortedItems({
      entries: items,
      sort: block.attributes.query.sort || [
        {term: 'UpdateTime', reverse: false},
      ],
    })

    return block.attributes.query.limit
      ? sorted.slice(0, block.attributes.query.limit)
      : sorted
  }, [hasSSRContext, supportQueries, directoryItems, block.attributes.query])

  // Extract author IDs for metadata loading
  const authorIds = useMemo(() => {
    const ids = new Set<string>()
    sortedItems.forEach(
      (item) => item.authors?.forEach((authorId: string) => ids.add(authorId)),
    )
    return Array.from(ids)
  }, [sortedItems])

  // Desktop: batch load documents and authors
  const docIds = useMemo(
    () =>
      !hasSSRContext
        ? sortedItems.map((item) =>
            hmId(item.account, {path: item.path, latest: true}),
          )
        : [],
    [hasSSRContext, sortedItems],
  )

  const documents = !hasSSRContext
    ? client.useResources([
        ...docIds,
        ...authorIds.map((uid: string) => hmId(uid)),
      ])
    : null

  // Get accounts metadata from appropriate source
  const accountsMetadata = !hasSSRContext
    ? client.useAccountsMetadata(authorIds)
    : supportDocuments?.reduce((acc: any, d: any) => {
        if (!d.document?.metadata) return acc
        if (d.id.path?.length) return acc
        acc[d.id.uid] = {
          id: d.id,
          metadata: d.document.metadata,
        }
        return acc
      }, {}) || {}

  // Get entity helper function
  function getEntity(path: string[]) {
    if (hasSSRContext) {
      return supportDocuments?.find(
        (entity: any) => entity?.id?.path?.join('/') === path?.join('/'),
      )
    }
    return (
      documents?.find(
        (document: any) =>
          document.data?.id?.path?.join('/') === path?.join('/'),
      )?.data || null
    )
  }

  // Handle validation errors for web
  if (hasSSRContext) {
    const includes = block.attributes.query.includes || []
    if (includes.length === 0) return null
    const queryInclude = includes[0]
    if (!queryInclude || includes.length !== 1)
      return <ErrorBlock message="Only one query include supported" />
    if (!queryInclude.space) return <ErrorBlock message="Empty Query" />
  }

  return (
    <QueryBlockContent
      items={sortedItems}
      style={block.attributes.style || 'Card'}
      columnCount={block.attributes.columnCount}
      banner={block.attributes.banner || false}
      accountsMetadata={accountsMetadata}
      getEntity={getEntity}
    />
  )
}

// document -> BlockContentQuery -> QueryBlock (from embeds package)
// editor -> QueryBlock -> EditorQueryBlock
export function BlockContentQuery({block}: BlockContentProps<HMBlockQuery>) {
  // Query blocks don't use block.link, they store target in attributes.query.includes
  const includes = block.attributes.query.includes || []

  // Empty includes means unconfigured query block - show empty state
  if (includes.length === 0 || !includes[0]?.space) {
    // Return empty QueryBlockContent to show "no results" state
    return (
      <QueryBlockContent
        items={[]}
        style={block.attributes.style || 'Card'}
        columnCount={block.attributes.columnCount}
        banner={block.attributes.banner || false}
        accountsMetadata={{}}
      />
    )
  }

  const queryInclude = includes[0]
  const id = hmId(queryInclude.space, {
    path: queryInclude.path
      ? queryInclude.path.split('/').filter(Boolean)
      : null,
  })

  return <QueryBlock id={id} block={block} />
}

export function BlockNotFoundError({
  message,
  children,
}: PropsWithChildren<{
  message: string
}>) {
  return (
    <div className="flex flex-1 flex-col bg-red-100/50 p-2 dark:bg-red-900/50">
      <div className="flex items-center gap-2 p-4">
        <AlertCircle className="flex-0 text-red-500" size={12} />
        <SizableText className="flex-1" color="destructive">
          {message ? message : 'Error'}
        </SizableText>
      </div>
      {children}
    </div>
  )
}

export function BlockContentUnknown(props: BlockContentProps<HMBlock>) {
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

export function BlockContentFile({block}: BlockContentProps<HMBlockFile>) {
  const {saveCidAsFile} = useDocContentContext()
  const fileCid = block.link ? extractIpfsUrlCid(block.link) : ''
  if (block.type !== 'File') return null
  return (
    <div
      data-content-type="file"
      data-url={block.link}
      data-name={getBlockAttribute(block.attributes, 'name')}
      data-size={getBlockAttribute(block.attributes, 'size')}
      className={cn(
        'block-content group block-file border-muted dark:border-muted relative overflow-hidden rounded-md border p-4',
      )}
    >
      <div className="relative flex w-full flex-1 items-center gap-2">
        <File size={18} className="flex-0" />
        <SizableText className="flex-1 truncate overflow-hidden text-sm whitespace-nowrap select-text">
          {getBlockAttribute(block.attributes, 'name') || 'Untitled File'}
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
          <a
            download
            {...(saveCidAsFile
              ? {
                  onClick: () => {
                    saveCidAsFile(
                      fileCid,
                      getBlockAttribute(block.attributes, 'name') || 'File',
                    )
                  },
                }
              : {
                  download: getBlockAttribute(block.attributes, 'name') || true,
                  href: getDaemonFileUrl(fileCid),
                  style: {
                    textDecoration: 'none',
                  },
                })}
          >
            Download
          </a>
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
  const {layoutUnit, debug} = useDocContentContext()
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
    <pre
      data-content-type="code"
      className={cn(
        blockStyles,
        `w-full overflow-auto rounded-md border language-${language} border-border bg-background`,
      )}
      style={
        {
          padding: layoutUnit / 2,
          ...debugStyles(debug, 'blue'),
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

export function BlockContentMath({
  block,
  parentBlockId,
  ...props
}: BlockContentProps<HMBlockMath>) {
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
  ...props
}: BlockContentProps & {
  children: string
  entityId: UnpackedHypermediaId
  style?: React.CSSProperties
}) {
  const buttonProps = useRouteLink({key: 'document', id: entityId})
  const hasRangeHighlight = style?.backgroundColor === 'var(--brand-10)'
  return (
    <a
      {...buttonProps}
      onMouseEnter={() => props.onHoverIn?.(entityId)}
      onMouseLeave={() => props.onHoverOut?.(entityId)}
      className={cn(
        'font-bold text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300',
        hasRangeHighlight && 'hm-embed-range bg-brand-10 hover:cursor-default',
      )}
      data-inline-embed={packHmId(entityId)}
      // this data attribute is used by the hypermedia highlight component
      data-blockid={entityId.blockRef}
      data-docid={entityId.blockRef ? undefined : entityId.id}
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
  firstItem: {id: UnpackedHypermediaId; item: HMDocumentInfo} | null
  items: Array<{id: UnpackedHypermediaId; item: HMDocumentInfo}>
  getEntity: any
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
            entity={getEntity(firstItem.item.path)}
            docId={firstItem.id}
            key={firstItem.item.path.join('/')}
            accountsMetadata={accountsMetadata}
          />
        </div>
      ) : null}
      {items?.length ? (
        <div className="-mx-3 mt-2 flex flex-wrap justify-center">
          {items.map((item) => {
            if (!item) return null
            return (
              <div
                className={cn(columnClasses, 'flex p-3')}
                key={item.item.account + '/' + item.item.path.join('/')}
              >
                <DocumentCard
                  docId={item.id}
                  entity={getEntity(item.item.path)}
                  key={item.item.path.join('/')}
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
  return (
    <Tooltip content={tooltip} delay={800}>
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
    </Tooltip>
  )
}
