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
import {SizeTokens, Text, TextProps, Theme, useThemeName} from '@tamagui/core'
import {ColorProp} from '@tamagui/helpers-tamagui'
import {Label} from '@tamagui/label'
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
  Reply,
  Undo2,
} from '@tamagui/lucide-icons'
import {RadioGroup} from '@tamagui/radio-group'
import {
  extractIpfsUrlCid,
  getDaemonFileUrl,
  isIpfsUrl,
  useFileUrl,
  useImageUrl,
} from './get-file-url'

import {SizableText, SizableTextProps} from '@shm/ui/text'
import {XStack, XStackProps, YStack, YStackProps} from '@tamagui/stacks'
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
        <YStack
          zIndex="$zIndex.4"
          padding="$2"
          // @ts-ignore
          position="fixed"
          borderColor="$color7"
          borderWidth={1}
          bottom={16}
          right={16}
          backgroundColor="$backgroundHover"
        >
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
            <XStack gap="$2">
              <SizableText size="$1">Text unit:</SizableText>
              <RadioGroupItemWithLabel value="14" label="14" />
              <RadioGroupItemWithLabel value="16" label="16" />
              <RadioGroupItemWithLabel value="18" label="18" />
              <RadioGroupItemWithLabel value="20" label="20" />
              <RadioGroupItemWithLabel value="24" label="24" />
            </XStack>
          </RadioGroup>
          <RadioGroup
            aria-labelledby="layout unit"
            defaultValue="24"
            name="form"
            onValueChange={(val) => setLUnit(Number(val))}
          >
            <XStack gap="$2">
              <SizableText size="$1">Layout unit:</SizableText>
              <RadioGroupItemWithLabel value="16" label="16" />
              <RadioGroupItemWithLabel value="20" label="20" />
              <RadioGroupItemWithLabel value="24" label="24" />
              <RadioGroupItemWithLabel value="28" label="28" />
              <RadioGroupItemWithLabel value="32" label="32" />
            </XStack>
          </RadioGroup>
        </YStack>
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

function debugStyles(debug: boolean = false, color: ColorProp = '$color7') {
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
  marginVertical = '$5',
  handleBlockReplace,
  ...props
}: XStackProps & {
  document: HMDocument
  focusBlockId?: string | undefined
  maxBlockCount?: number
  marginVertical?: any
  handleBlockReplace?: () => boolean
}) {
  const {wrapper, bubble, coords, state} = useRangeSelection()
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

  return (
    <YStack
      ref={wrapper}
      paddingHorizontal={layoutUnit / 3}
      $gtMd={{paddingHorizontal: layoutUnit / 2}}
      marginVertical={marginVertical}
      {...props}
    >
      <XStack
        ref={bubble}
        {...coords}
        zIndex="$zIndex.5"
        position="absolute"
        elevation="$4"
        userSelect="none"
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
        {/* {onBlockCommentClick ? (
          <Tooltip content="Add a Comment">
            <Button
              size="$2"
              icon={Comment}
              onPress={() => {
                // send({type: "CREATE_COMMENT"});
                // onBlockCommentClick(
                //   state.context.blockId,
                //   typeof state.context.rangeStart == "number" &&
                //     typeof state.context.rangeEnd == "number"
                //     ? {
                //         start: state.context.rangeStart,
                //         end: state.context.rangeEnd,
                //       }
                //     : undefined
                // );
              }}
            />
          </Tooltip>
        ) : null} */}
      </XStack>
      <BlocksContent
        blocks={displayBlocks}
        parentBlockId={null}
        handleBlockReplace={handleBlockReplace}
      />
    </YStack>
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
    <BlockNodeList childrenType="Group">
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
}: YStackProps & {
  childrenType?: HMBlockChildrenType
  listLevel?: string | number
}) {
  const tag = useMemo(() => {
    if (childrenType == 'Ordered') return 'ol'
    if (childrenType == 'Unordered') return 'ul'
    if (childrenType == 'Blockquote') return 'blockquote'
    return 'div'
  }, [childrenType])

  return (
    <YStack
      tag={tag}
      className="blocknode-list"
      data-node-type="blockGroup"
      data-list-type={childrenType}
      data-list-level={listLevel}
      width="100%"
      {...props}
    >
      {childrenType === 'Ordered' ? (
        <ol style={{all: 'unset'}}>{children}</ol>
      ) : childrenType === 'Unordered' ? (
        <ul style={{all: 'unset'}}>{children}</ul>
      ) : childrenType === 'Blockquote' ? (
        <blockquote style={{all: 'unset'}}>{children}</blockquote>
      ) : (
        <div>{children}</div>
      )}
    </YStack>
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
  const themeName = useThemeName()
  const highlightColor =
    themeName === 'dark'
      ? CONTENT_HIGHLIGHT_COLOR_DARK
      : CONTENT_HIGHLIGHT_COLOR_LIGHT

  // // @ts-expect-error
  // if (isBlockNodeEmpty(blockNode)) {
  //   return null;
  // }

  return (
    <YStack
      ref={elm}
      className="blocknode-content"
      id={comment ? undefined : blockNode.block?.id}
      borderColor={isHighlight ? '$brandHighlight' : '$colorTransparent'}
      borderWidth={1}
      borderRadius={layoutUnit / 4}
      bg={isHighlight ? highlightColor : '$backgroundTransparent'}
      data-node-type="blockContainer"
      data-block-type={blockNode.block?.type}
      // onHoverIn={() => (props.embedDepth ? undefined : hoverProps.onHoverIn())}
      // onHoverOut={() =>
      //   props.embedDepth ? undefined : hoverProps.onHoverOut()
      // }
    >
      <XStack
        borderRadius={layoutUnit / 4}
        padding={layoutUnit / 3}
        paddingVertical={isEmbed ? 0 : layoutUnit / 6}
        {...headingStyles}
        {...debugStyles(debug, 'red')}
        group="blocknode"
        className={
          blockNode.block!.type == 'Heading' ? 'blocknode-content-heading' : ''
        }
        bg={
          hover
            ? isDark
              ? '$backgroundStrong'
              : '$background'
            : '$backgroundTransparent'
        }
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
              opacity={_expanded ? 0 : 1}
              hoverStyle={{
                opacity: 1,
              }}
              bg="$background"
              $group-blocknode-hover={{
                opacity: 1,
              }}
            />
          </Tooltip>
        ) : null}

        {/* <BlockNodeMarker
          block={blockNode.block!}
          childrenType={childrenType}
          index={props.index}
          start={props.start}
        /> */}
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
        <YStack
          position={'absolute'}
          zIndex={hover ? '$zIndex.9' : '$zIndex.1'}
          bg={
            hover
              ? isDark
                ? '$background'
                : '$backgroundStrong'
              : '$backgroundTransparent'
          }
          right={0}
          top={0}
          $gtSm={{
            right: -44,
            // background: '$backgroundTransparent',
          }}
          pl="$2"
          borderRadius={layoutUnit / 4}
          gap="$1"
          onHoverIn={() => setHover(true)}
          onHoverOut={() => setHover(false)}
          // paddingBottom={hover ? 100 : 0}
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
                icon={<BlockQuote size={12} color="$color9" />}
              >
                <SizableText color="$color9" size="$1">
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
                background={isDark ? '$background' : '$backgroundStrong'}
                opacity={0}
                $group-blocknode-hover={{
                  opacity: 1,
                }}
                padding={layoutUnit / 4}
                borderRadius={layoutUnit / 4}
                icon={Reply}
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
                opacity={citationsCount?.comments ? 1 : 0}
                $group-blocknode-hover={{
                  opacity: 1,
                }}
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
                icon={<MessageSquare size={12} color="$color9" />}
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
                background={isDark ? '$background' : '$backgroundStrong'}
                userSelect="none"
                size="$1"
                opacity={0}
                $group-blocknode-hover={{
                  opacity: 1,
                }}
                padding={layoutUnit / 4}
                borderRadius={layoutUnit / 4}
                chromeless
                icon={<Link size={12} color="$color9" />}
                onPress={() => {
                  if (blockNode.block?.id) {
                    onBlockCopy(blockNode.block.id, {expanded: true})
                  } else {
                    console.error('onBlockCopy Error: no blockId available')
                  }
                }}
              >
                <SizableText color="$color9" size="$1">
                  {' '}
                </SizableText>
              </Button>
            </Tooltip>
          ) : null}
        </YStack>
      </XStack>
      {bnChildren && _expanded ? (
        <BlockNodeList
          paddingLeft={layoutUnit}
          childrenType={blockNode.block?.attributes?.childrenType}
          listLevel={listLevel}
          display="block"
        >
          {bnChildren}
        </BlockNodeList>
      ) : null}
    </YStack>
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

export const blockStyles: YStackProps = {
  width: '100%',
  alignSelf: 'center',
  flex: 1,
}

function inlineContentSize(unit: number): TextProps {
  return {
    fontSize: unit,
    lineHeight: unit * 1.3,
    $gtMd: {
      fontSize: unit * 1.1,
    },
    $gtLg: {
      fontSize: unit * 1.2,
    },
  }
}

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
    <YStack
      {...blockStyles}
      {...props}
      {...debugStyles(debug, 'blue')}
      className="block-content block-paragraph"
    >
      <Text
        className={`content-inline ${comment ? 'is-comment' : ''}`}
        {...inlineContentSize(textUnit)}
      >
        <InlineContentView inline={inline} />
      </Text>
    </YStack>
  )
}

export function BlockContentHeading({
  block,
  depth,
  parentBlockId,
  ...props
}: BlockContentProps) {
  const {textUnit, debug, comment} = useDocContentContext()
  let inline = useMemo(() => hmBlockToEditorBlock(block).content, [block])
  let headingTextStyles = useHeadingTextStyles(
    depth,
    comment ? textUnit * 0.8 : textUnit,
    comment,
  )

  return (
    <YStack
      {...blockStyles}
      {...props}
      {...debugStyles(debug, 'blue')}
      className="block-content block-heading"
    >
      <SeedHeading
        level={depth as 1 | 2 | 3 | 4 | undefined}
        className="content-inline"
        maxWidth="95%"
      >
        <InlineContentView
          inline={inline}
          fontWeight="bold"
          fontFamily="$heading"
          {...headingTextStyles}
        />
      </SeedHeading>
    </YStack>
  )
}

export function DocHeading({
  children,
  right,
}: {
  children?: string
  right?: React.ReactNode
}) {
  const {debug, layoutUnit} = useDocContentContext()
  return (
    <Theme name="subtle">
      <YStack
        paddingHorizontal={layoutUnit / 3}
        $gtMd={{paddingHorizontal: layoutUnit / 2}}
        group="header"
      >
        <YStack
          padding={layoutUnit / 3}
          // marginBottom={layoutUnit}
          paddingBottom={layoutUnit / 2}
          // {...headingMarginStyles}
        >
          <XStack>
            <YStack {...blockStyles} {...debugStyles(debug, 'blue')}>
              <SeedHeading
                level={1}
                className="content-inline"
                fontFamily={'$body'}
                maxWidth="95%"
              >
                {children}
              </SeedHeading>
            </YStack>
            {right}
          </XStack>
        </YStack>
      </YStack>
    </Theme>
  )
}

export function useHeadingTextStyles(
  depth: number,
  unit: number,
  comment?: boolean,
) {
  return useMemo(() => {
    if (comment) {
      return {
        fontSize: '$3',
        lineHeight: '$3',
        $gtMd: {
          fontSize: '$3',
          lineHeight: '$3',
        },
        $gtLg: {
          fontSize: '$4',
          lineHeight: '$4',
        },
      } satisfies TextProps
    }
    if (depth == 1) {
      return {
        fontSize: '$8',
        lineHeight: '$8',
        $gtMd: {
          fontSize: '$9',
          lineHeight: '$9',
        },
      } satisfies TextProps
    }

    if (depth == 2) {
      return {
        fontSize: '$7',
        lineHeight: '$7',
        $gtMd: {
          fontSize: '$8',
          lineHeight: '$8',
        },
        $gtLg: {
          fontSize: '$9',
          lineHeight: '$9',
        },
      } satisfies TextProps
    }

    if (depth == 3) {
      return {
        fontSize: '$6',
        lineHeight: '$6',
        $gtMd: {
          fontSize: '$7',
          lineHeight: '$7',
        },
        $gtLg: {
          fontSize: '$8',
          lineHeight: '$8',
        },
      } satisfies TextProps
    }

    if (depth == 4) {
      return {
        fontSize: '$5',
        lineHeight: '$5',
        $gtMd: {
          fontSize: '$6',
          lineHeight: '$6',
        },
        $gtLg: {
          fontSize: '$7',
          lineHeight: '$7',
        },
      } satisfies TextProps
    }

    return {
      fontSize: '$5',
      lineHeight: '$5',
      $gtMd: {
        fontSize: '$6',
        lineHeight: '$6',
      },
      $gtLg: {
        fontSize: '$7',
        lineHeight: '$7',
      },
    } satisfies TextProps
  }, [depth, unit])
}

export function useHeadingMarginStyles(
  depth: number,
  unit: number,
  isFirst?: boolean,
) {
  function headingFontValues(value: number) {
    return {
      marginTop: value,
    }
  }

  return useMemo(() => {
    if (isFirst) {
      return {
        marginTop: 0,
      } satisfies TextProps
    } else {
      if (depth == 1) {
        return {
          ...headingFontValues(unit * 1.3),
          $gtMd: headingFontValues(unit * 1.4),
          $gtLg: headingFontValues(unit * 1.5),
        } satisfies TextProps
      }

      if (depth == 2) {
        return {
          ...headingFontValues(unit * 1.2),
          $gtMd: headingFontValues(unit * 1.25),
          $gtLg: headingFontValues(unit * 1.3),
        } satisfies TextProps
      }

      if (depth == 3) {
        return {
          ...headingFontValues(unit * 1),
          $gtMd: headingFontValues(unit * 1.15),
          $gtLg: headingFontValues(unit * 1.2),
        } satisfies TextProps
      }

      return {
        ...headingFontValues(unit),
        $gtMd: headingFontValues(unit),
        $gtLg: headingFontValues(unit),
      } satisfies TextProps
    }
  }, [depth, unit])
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
    <YStack
      {...blockStyles}
      {...props}
      className="block-content block-image"
      data-content-type="image"
      data-url={block?.link}
      data-name={block?.attributes?.name}
      data-width={getBlockAttribute(block.attributes, 'width')}
      maxWidth="100%"
      paddingVertical="$3"
      gap="$2"
      ai="center"
      width="100%"
    >
      <YStack
        width={
          getBlockAttribute(block.attributes, 'width')
            ? `${getBlockAttribute(block.attributes, 'width')}px`
            : undefined
        }
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
      </YStack>
      {inline.length ? (
        <Text opacity={0.7} fontFamily="$body">
          <InlineContentView inline={inline} fontSize={textUnit * 0.85} />
        </Text>
      ) : null}
    </YStack>
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
    <YStack
      {...blockStyles}
      {...props}
      className="block-content block-video"
      paddingVertical="$3"
      gap="$2"
      data-content-type="video"
      data-url={link}
      data-name={getBlockAttribute(block.attributes, 'name')}
      position="relative"
      width="100%"
      ai="center"
    >
      {link ? (
        <YStack
          width={
            getBlockAttribute(block.attributes, 'width')
              ? `${getBlockAttribute(block.attributes, 'width')}px`
              : '100%'
          }
          maxWidth="100%"
          position="relative"
          paddingBottom={isIpfs || link.startsWith('http') ? '56.25%' : 'auto'}
          height={0}
        >
          {isIpfs ? (
            <XStack
              tag="video"
              top={0}
              left={0}
              position="absolute"
              width="100%"
              height="100%"
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
            </XStack>
          ) : (
            <XStack
              tag="iframe"
              top={0}
              left={0}
              position="absolute"
              width="100%"
              height="100%"
              src={getVideoIframeSrc(block.link)}
              frameBorder="0"
              allowFullScreen
            />
          )}
        </YStack>
      ) : (
        <Text>Video block wrong state</Text>
      )}
      {inline.length ? (
        <Text opacity={0.7}>
          <InlineContentView fontSize={textUnit * 0.85} inline={inline} />
        </Text>
      ) : null}
    </YStack>
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
  style,
  linkType = null,
  fontSize,
  rangeOffset,
  isRange = false,
  ...props
}: SizableTextProps & {
  inline: HMInlineContent[]
  linkType?: LinkType
  fontSize?: number
  rangeOffset?: number
  isRange?: boolean
}) {
  const {textUnit, entityComponents, comment, onHoverIn, onHoverOut} =
    useDocContentContext()

  const InlineEmbed = entityComponents.Inline

  let contentOffset = rangeOffset || 0
  const theme = useThemeName()

  const fSize = fontSize || textUnit
  const rangeColor =
    theme === 'dark'
      ? CONTENT_HIGHLIGHT_COLOR_DARK
      : CONTENT_HIGHLIGHT_COLOR_LIGHT
  return (
    <Text
      fontSize={fSize}
      lineHeight={fSize * 1.5}
      data-range-offset={contentOffset}
      whiteSpace="pre-wrap"
      {...props}
      alignContent="flex-start"
      alignItems="flex-start"
    >
      {inline.map((content, index) => {
        const inlineContentOffset = contentOffset
        contentOffset += getInlineContentOffset(content)
        if (content.type === 'text') {
          let textDecorationLine:
            | 'none'
            | 'line-through'
            | 'underline'
            | 'underline line-through'
            | undefined
          const underline = linkType || content.styles.underline
          if (underline) {
            if (content.styles.strike) {
              textDecorationLine = 'underline line-through'
            } else {
              textDecorationLine = 'underline'
            }
          } else if (content.styles.strike) {
            textDecorationLine = 'line-through'
          }

          let children: any = content.text.split('\n')

          // we are checking if this is the last inline content and if it has more than one line
          // if so, we are rendering a <br /> for each line
          if (inline.length == index + 1 && children.length > 1) {
            children = children.map(
              (l: string, i: number, a: Array<string>) => {
                if (a.length == i - 1) {
                  return l
                } else {
                  return (
                    <>
                      {l}
                      <br />
                    </>
                  )
                }
              },
            )
          } else {
            children = content.text
          }

          if (content.styles.range) {
            children = <Text backgroundColor={rangeColor}>{children}</Text>
          }

          if (content.styles.bold) {
            children = (
              <Text
                fontWeight="bold"
                fontSize={fSize}
                lineHeight={fSize * 1.5}
                data-range-offset={inlineContentOffset}
              >
                {children}
              </Text>
            )
          }

          if (content.styles.italic) {
            children = (
              <Text
                fontStyle="italic"
                fontSize={fSize}
                lineHeight={fSize * 1.5}
                data-range-offset={inlineContentOffset}
              >
                {children}
              </Text>
            )
          }

          if (content.styles.code) {
            children = (
              <Text
                backgroundColor={isRange ? rangeColor : '$color4'}
                fontFamily="$mono"
                tag="code"
                borderRadius="$2"
                overflow="hidden"
                fontSize={fSize * 0.85}
                lineHeight={fSize * 1.5}
                paddingHorizontal="$2"
                paddingVertical={2}
                data-range-offset={inlineContentOffset}
              >
                {children}
              </Text>
            )
          }

          // does anything use this?
          // if (content.styles.backgroundColor) {
          //   children = (
          //     <span style={{backgroundColor: content.styles.backgroundColor}}>
          //       {children}
          //     </span>
          //   )
          // }

          // if (content.styles.strike) {
          //   children = <s>{children}</s>
          // }

          // does anything use this?
          // if (content.styles.textColor) {
          //   children = (
          //     <span style={{color: content.styles.textColor}}>{children}</span>
          //   )
          // }

          return (
            <Text
              key={`${content.type}-${index}`}
              color={hmTextColor(linkType)}
              textDecorationColor="currentColor"
              style={{textDecorationLine, textDecorationColor: 'currentColor'}}
              fontSize={fSize}
              lineHeight={fSize * 1.5}
              data-range-offset={inlineContentOffset}
            >
              {children}
            </Text>
          )
        }
        if (content.type === 'link') {
          const isHmScheme = isHypermediaScheme(content.href)
          return (
            <HrefLink
              href={content.href}
              key={index}
              buttonProps={{
                className: isHmScheme ? 'hm-link' : 'link',
                target: isHmScheme ? undefined : '_blank',
              }}
              onHoverIn={onHoverIn}
              onHoverOut={onHoverOut}
            >
              <InlineContentView
                fontSize={fSize}
                lineHeight={fSize * 1.5}
                inline={content.content}
                linkType={isHmScheme ? 'hypermedia' : 'basic'}
                rangeOffset={inlineContentOffset}
              />
            </HrefLink>
          )
        }

        if (content.type == 'inline-embed') {
          const unpackedRef = unpackHmId(content.link)
          return (
            <InlineEmbed
              comment={comment}
              key={content.link}
              {...unpackedRef}
            />
          )
        }

        if (content.type == 'range') {
          return (
            <Text backgroundColor={rangeColor}>
              <InlineContentView
                isRange
                fontSize={fSize}
                lineHeight={fSize * 1.5}
                inline={content.content}
                rangeOffset={inlineContentOffset}
              />
            </Text>
          )
        }
        return null
      })}
    </Text>
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
      <YStack f={1} className="block-content block-unknown">
        <ButtonFrame
          theme="red"
          gap="$2"
          onPress={(e) => {
            e.stopPropagation()
            toggleOpen((v) => !v)
          }}
        >
          <SizableText flex={1} color="$red10">
            {message ? message : 'Error'}
          </SizableText>
          <AlertCircle color="$red10" size={12} />
        </ButtonFrame>
        {open ? (
          <XStack
            padding="$2"
            borderRadius="$3"
            margin="$2"
            backgroundColor="$backgroundHover"
          >
            <Text tag="pre" wordWrap="break-word" width="100%" fontSize={12}>
              <Text
                tag="code"
                fontSize={12}
                backgroundColor="transparent"
                fontFamily="$mono"
              >
                {JSON.stringify(debugData, null, 4)}
              </Text>
            </Text>
          </XStack>
        ) : null}
      </YStack>
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
  }
  //  else if (embedData.data.blockRange) {
  //   content = (
  //     <SizableText
  //       {...inlineContentSize(textUnit * 0.8)}
  //       fontFamily="$editorBody"
  //       fontStyle="italic"
  //     >
  //       {embedData.data.blockRange}
  //     </SizableText>
  //   )
  // }
  else if (embedData.data.embedBlocks) {
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
          <XStack jc="flex-end">
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
          </XStack>
        ) : null}
      </>
    )
  } else if (props.blockRef) {
    return (
      <BlockNotFoundError
        message={`Block #${props.blockRef} was not found in this version`}
      >
        <XStack gap="$2" paddingHorizontal="$4">
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
        </XStack>
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
    <YStack backgroundColor="$color4" p="$4" borderRadius="$4" ai="center">
      <SizableText
        fontSize="$4"
        color="$color9"
        fontWeight="bold"
        fontStyle="italic"
      >
        {message}
      </SizableText>
    </YStack>
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
    <YStack
      theme="red"
      backgroundColor="$backgroundHover"
      f={1}
      paddingVertical="$2"
    >
      <XStack gap="$2" paddingHorizontal="$4" paddingVertical="$2" ai="center">
        <AlertCircle color="$red10" size={12} />
        <SizableText flex={1} color="$red10">
          {message ? message : 'Error'}
        </SizableText>
      </XStack>
      {children}
    </YStack>
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
    <YStack
      // backgroundColor="$color3"
      borderColor="$color6"
      {...hoverProps}
      borderWidth={1}
      borderRadius={layoutUnit / 4}
      padding={layoutUnit / 2}
      overflow="hidden"
      f={1}
      className="block-content block-file"
      data-content-type="file"
      data-url={block.link}
      data-name={getBlockAttribute(block.attributes, 'name')}
      data-size={getBlockAttribute(block.attributes, 'size')}
      hoverStyle={{
        backgroundColor: '$backgroundHover',
      }}
      // Props include some hover handlers that interrupt local hover handlers
      // {...props}
    >
      <XStack
        borderWidth={0}
        outlineWidth={0}
        alignItems="center"
        space
        flex={1}
        width="100%"
      >
        <File size={18} />

        <SizableText
          size="$5"
          // maxWidth="17em"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          userSelect="text"
          flex={1}
        >
          {getBlockAttribute(block.attributes, 'name') || 'Untitled File'}
        </SizableText>
        {getBlockAttribute(block.attributes, 'size') && (
          <SizableText paddingTop="$1" color="$color10" size="$2">
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
      </XStack>
    </YStack>
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
      {...blockStyles}
      {...props}
      borderColor="$color6"
      backgroundColor="$color4"
      borderWidth={1}
      borderRadius={layoutUnit / 4}
      padding={layoutUnit / 2}
      overflow="hidden"
      width="100%"
      marginHorizontal={(-1 * layoutUnit) / 2}
      className="x-post-container"
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
      {...blockStyles}
      {...props}
      borderColor="$color6"
      backgroundColor="$color4"
      borderWidth={1}
      borderRadius={layoutUnit / 4}
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
      {...blockStyles}
      {...props}
      className="block-content block-katex"
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
    <XStack alignItems="center" space="$2">
      <Checkbox id={id} size={size} {...checkboxProps}>
        <Checkbox.Indicator>
          <Check />
        </Checkbox.Indicator>
      </Checkbox>

      <Label size={size} htmlFor={id}>
        {label}
      </Label>
    </XStack>
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
    <XStack alignItems="center" space="$2">
      <RadioGroup.Item value={props.value} id={id} size="$1">
        <RadioGroup.Indicator />
      </RadioGroup.Item>

      <Label size="$1" htmlFor={id}>
        {props.label}
      </Label>
    </XStack>
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
