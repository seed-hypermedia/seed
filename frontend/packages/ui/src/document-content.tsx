import {useNavigate} from '@remix-run/react'
import {
  CONTENT_HIGHLIGHT_COLOR_DARK,
  CONTENT_HIGHLIGHT_COLOR_LIGHT,
  createWebHMUrl,
  formatBytes,
  formattedDate,
  getDocumentTitle,
  HMAccountsMetadata,
  HMBlockChildrenType,
  HMBlockNode,
  HMBlockQuery,
  hmBlockToEditorBlock,
  HMDocument,
  HMDocumentInfo,
  hmId,
  hmIdPathToEntityQueryPath,
  HMInlineContent,
  HMLoadedBlockNode,
  HMLoadedButton,
  HMLoadedCode,
  HMLoadedDocument,
  HMLoadedEmbed,
  HMLoadedFile,
  HMLoadedInlineEmbedNode,
  HMLoadedMath,
  HMLoadedQuery,
  isHypermediaScheme,
  narrowHmId,
  packHmId,
  pluralS,
  queryBlockSortedItems,
  UnpackedHypermediaId,
  unpackHmId,
  useHover,
  useLowlight,
  useOpenUrl,
  useRangeSelection,
  useRouteLink,
  useRouteLinkHref,
  useUniversalAppContext,
} from '@shm/shared'
import {
  BlockContentProps,
  DocContentContextValue,
} from '@shm/shared/document-content-types'
import {HMDocCard, HMDocCardBanner} from '@shm/ui/doc-card'
import {BlankQueryBlockMessage} from '@shm/ui/entity-card'
import {HMIcon} from '@shm/ui/hm-icon'
import {Spinner} from '@shm/ui/spinner'
import {Button, ButtonFrame, ButtonText} from '@tamagui/button'
import {Checkbox, CheckboxProps} from '@tamagui/checkbox'
import {
  SizeTokens,
  StackProps,
  Text,
  TextProps,
  Theme,
  useThemeName,
} from '@tamagui/core'
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
import {XStack, XStackProps, YStack, YStackProps} from '@tamagui/stacks'
import {SizableText, SizableTextProps} from '@tamagui/text'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import {common} from 'lowlight'
import {
  ComponentProps,
  createContext,
  createElement,
  memo,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  extractIpfsUrlCid,
  getDaemonFileUrl,
  isIpfsUrl,
  useFileUrl,
  useImageUrl,
} from './get-file-url'
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
import {contentLayoutUnit, contentTextUnit} from './document-content-constants'
import './document-content.css'
import {SeedHeading} from './heading'
import {BlockQuote} from './icons'
import {Tooltip} from './tooltip'
import {useIsDark} from './use-is-dark'
// import {XPostNotFound, XPostSkeleton} from "./x-components";
import {EntityComponentProps} from '@shm/shared/document-content-types'

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
        textUnit: comment ? tUnit * 0.9 : tUnit,
        debug,
        ffSerif,
        comment,
        routeParams,
        collapsedBlocks,
        setCollapsedBlocks,
      }}
    >
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
      {children}
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

function getFocusedBlocks(blocks: HMLoadedBlockNode[], blockId?: string) {
  if (!blockId) return blocks
  const focused = getBlockNodeById(blocks, blockId)
  if (focused) return [focused]
  return null
}

export function DocContent({
  document,
  focusBlockId,
  marginVertical = '$5',
  handleBlockReplace,
  ...props
}: XStackProps & {
  document: HMLoadedDocument
  focusBlockId?: string | undefined
  marginVertical?: any
  handleBlockReplace?: () => boolean
}) {
  const {wrapper, bubble, coords, state} = useRangeSelection()
  const {layoutUnit, onCopyBlock} = useDocContentContext()
  const allBlocks = document?.content || []
  const displayBlocks = getFocusedBlocks(allBlocks, focusBlockId)

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
        {onCopyBlock ? (
          <Tooltip content="Copy Block Range">
            <Button
              size="$2"
              icon={Link}
              onPress={() => {
                onCopyBlock(
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
  blocks?: Array<HMLoadedBlockNode> | null
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
              childrenType={bn.childrenType}
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

// function BlockNodeMarker({
//   block,
//   childrenType,
//   index = 0,
//   start = '1',
// }: {
//   block: Block
//   childrenType?: string
//   start?: string
//   index?: number
//   headingTextStyles: TextProps
// }) {
//   const {layoutUnit, textUnit, debug} = useDocContentContext()
//   let styles = useMemo(
//     () =>
//       childrenType == 'ol'
//         ? ({
//             position: 'absolute',
//             right: layoutUnit / 4,
//             marginTop: layoutUnit / 7,
//             fontSize: textUnit * 0.7,
//           } satisfies SizableTextProps)
//         : {},
//     [childrenType, textUnit, layoutUnit],
//   )
//   let marker

//   if (childrenType == 'ol') {
//     marker = `${index + Number(start)}.`
//   }

//   if (childrenType == 'ul') {
//     marker = '•'
//   }

//   if (!marker) return null

//   return (
//     <XStack
//       flex={0}
//       width={layoutUnit}
//       height={textUnit * 1.5}
//       alignItems="center"
//       justifyContent="flex-start"
//       {...debugStyles(debug, 'green')}
//     >
//       <Text {...styles} fontFamily="$body" userSelect="none" opacity={0.7}>
//         {marker}
//       </Text>
//     </XStack>
//   )
// }

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
  blockNode: HMLoadedBlockNode
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
    onCopyBlock,
    onReplyBlock,
    debug,
    comment,
  } = useDocContentContext()
  const [hover, setHover] = useState(false)
  const isDark = useIsDark()
  const headingMarginStyles = useHeadingMarginStyles(
    depth,
    layoutUnit,
    isFirstChild,
  )
  // const {hover, ...hoverProps} = useHover()
  const {docCitations, commentCitations} = useBlockCitations(
    blockNode.block?.id,
  )
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
          childrenType={bn.childrenType}
          listLevel={
            childrenType === 'Unordered' && bn.childrenType === 'Unordered'
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
      annotations: [...(blockNode.block.annotations || [])],
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
                ? 'You can collapse this block and hide its children'
                : 'This block is collapsed. you can expand it and see its children'
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
                ['Unordered', 'Ordered'].includes(childrenType || '')
                  ? 12
                  : undefined
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
          <Tooltip content="This block is collapsed. you can expand it and see its children">
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
          {docCitations?.length ? (
            <Tooltip
              content={`${docCitations.length} ${pluralS(
                docCitations.length,
                'document',
              )} citing this block`}
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
                  {docCitations.length ? String(docCitations.length) : ' '}
                </SizableText>
              </Button>
            </Tooltip>
          ) : null}

          {onReplyBlock ? (
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
                    onReplyBlock(blockNode.block.id)
                  } else {
                    console.error('onReplyBlock Error: no blockId available')
                  }
                }}
              />
            </Tooltip>
          ) : null}
          {onBlockCommentClick ? (
            <Tooltip
              content={
                commentCitations.length
                  ? `${commentCitations.length} ${pluralS(
                      commentCitations.length,
                      'comment',
                    )}`
                  : 'Comment on this block'
              }
              delay={800}
            >
              <Button
                userSelect="none"
                size="$1"
                background={isDark ? '$background' : '$backgroundStrong'}
                bg="red"
                opacity={commentCitations.length ? 1 : 0}
                $group-blocknode-hover={{
                  opacity: 1,
                }}
                padding={layoutUnit / 4}
                borderRadius={layoutUnit / 4}
                onPress={() => {
                  if (blockNode.block?.id) {
                    onBlockCommentClick(blockNode.block.id)
                  } else {
                    console.error(
                      'onBlockCommentClick Error: no blockId available',
                    )
                  }
                }}
                icon={<MessageSquare size={12} color="$color9" />}
              >
                <SizableText color="$color9" size="$1">
                  {commentCitations.length
                    ? String(commentCitations.length)
                    : ' '}
                </SizableText>
              </Button>
            </Tooltip>
          ) : null}
          {onCopyBlock ? (
            <Tooltip content="Copy Block Link (Exact Version)" delay={800}>
              <Button
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
                    onCopyBlock(blockNode.block.id, {expanded: true})
                  } else {
                    console.error('onCopyBlock Error: no blockId available')
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
          childrenType={blockNode.childrenType}
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

function BlockContent({block, ...props}: BlockContentProps) {
  const dataProps = {
    depth: props.depth || 1,
    'data-blockid': block.id,
  }
  if (block.type == 'Paragraph') {
    return <BlockContentParagraph block={block} {...props} {...dataProps} />
  }

  if (block.type == 'Heading') {
    return <BlockContentHeading block={block} {...props} {...dataProps} />
  }

  if (block.type == 'Image') {
    return <BlockContentImage block={block} {...props} {...dataProps} />
  }

  if (block.type == 'Video') {
    return <BlockContentVideo block={block} {...props} {...dataProps} />
  }

  // if (props.block.type == "nostr") {
  //   return <BlockContentNostr {...props} {...dataProps} />;
  // }

  if (block.type == 'File') {
    return <BlockContentFile block={block} {...props} {...dataProps} />
  }

  if (block.type == 'Button') {
    return <BlockContentButton block={block} {...props} {...dataProps} />
  }

  if (block.type == 'WebEmbed') {
    return <BlockContentXPost block={block} {...props} {...dataProps} />
  }

  if (block.type == 'Embed') {
    return <BlockContentEmbed block={block} {...props} {...dataProps} />
  }

  if (block.type == 'Code') {
    return <BlockContentCode block={block} {...props} {...dataProps} />
  }

  if (block.type == 'Math') {
    return <BlockContentMath block={block} {...props} {...dataProps} />
  }

  if (block.type == 'Query') {
    return <BlockContentQuery block={block} {...props} {...dataProps} />
  }

  return <BlockContentUnknown block={block} {...props} {...dataProps} />
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
      data-name={block?.name}
      data-width={block?.width}
      maxWidth="100%"
      paddingVertical="$3"
      gap="$2"
      ai="center"
      width="100%"
    >
      <YStack
        width={block?.width ? `${block.width}px` : undefined}
        maxWidth="100%"
      >
        <img
          alt={block?.name}
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
      data-name={block?.name}
      position="relative"
      width="100%"
      ai="center"
    >
      {link ? (
        <YStack
          width={block?.width ? `${block.width}px` : '100%'}
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
              <source src={fileUrl(link)} type={getSourceType(block?.name)} />
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
  const {textUnit, comment, onHoverIn, onHoverOut} = useDocContentContext()

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
            <DocInlineEmbed
              // comment={comment}
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

export function BlockContentEmbed(props: BlockContentProps<HMLoadedEmbed>) {
  if (props.block.embedId?.type == 'd') {
    return <BlockContentEmbedDocument {...props} />
  }
  if (props.block.embedId?.type == 'c') {
    return <BlockContentEmbedComment {...props} />
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
    }>
  >
  parentBlockId: string | null
}) {
  const context = useDocContentContext()

  const [isExpanded, setExpanded] = useState(
    props.block.embedId?.expanded ?? true,
  )

  useEffect(() => {
    setExpanded(!context.collapsedBlocks.has(props.block.id) ?? isExpanded)
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
        depth={props.depth}
        id={narrowHmId(props)}
        parentBlockId={parentBlockId || ''}
      >
        {content}
      </EmbedWrapper>
    </DocContentProvider>
  )
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

export function BlockContentFile({block}: BlockContentProps<HMLoadedFile>) {
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
      data-name={block?.name}
      data-size={block?.size}
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
          {block?.name || 'Untitled File'}
        </SizableText>
        {block?.size && (
          <SizableText paddingTop="$1" color="$color10" size="$2">
            {formatBytes(parseInt(String(block.size)))}
          </SizableText>
        )}

        {fileCid && (
          <Tooltip content={`Download ${block?.name || 'File'}`}>
            <Button
              position="absolute"
              right={0}
              opacity={hover ? 1 : 0}
              disabled={!hover}
              size="$2"
              {...(saveCidAsFile
                ? {
                    onPress: () => {
                      saveCidAsFile(fileCid, block?.name || 'File')
                    },
                  }
                : {
                    tag: 'a',
                    download: block?.name || true,
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
}: BlockContentProps<HMLoadedButton>) {
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
      justifyContent={block?.alignment || 'flex-start'}
      userSelect="none"
      className="block-content block-file"
      data-content-type="file"
      maxWidth="100%"
      data-url={block.link}
      data-name={block?.name}
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
            {block?.name}
          </SizableText>
        </Button>
      </XStack>
    </XStack>
  )
}

export function BlockContentXPost({
  block,
  parentBlockId,
  ...props
}: BlockContentProps<HMLoadedWebEmbed>) {
  const {layoutUnit} = useDocContentContext()
  const openUrl = useOpenUrl()
  const urlArray = block.link?.split('/')
  const xPostId = urlArray?.[urlArray.length - 1].split('?')[0]
  const containerRef = useRef(null)
  const isInitialized = useRef(false)
  const [loading, setLoading] = useState(false)

  const loadTwitterScript = () => {
    return new Promise((resolve) => {
      if (window.twttr) {
        resolve(window.twttr)
      } else {
        const script = document.createElement('script')
        script.src = 'https://platform.twitter.com/widgets.js'
        script.async = true
        script.onload = () => resolve(window.twttr)
        document.body.appendChild(script)
      }
    })
  }

  useEffect(() => {
    const initializeTweet = async () => {
      const twttr = await loadTwitterScript()
      if (!isInitialized.current && twttr) {
        twttr.widgets.createTweet(xPostId, containerRef.current, {
          theme: 'dark',
          align: 'center',
        })
        isInitialized.current = true
      }
    }
    setLoading(true)
    initializeTweet()
      .then((res) => setLoading(false))
      .catch((e) => setLoading(false))
  }, [xPostId])

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
      {loading && <Spinner />}
      <div ref={containerRef} />
    </YStack>
  )
}

export function BlockContentCode({
  block,
  parentBlockId,
  ...props
}: BlockContentProps<HMLoadedCode>) {
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
  const language = block.language
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
}: BlockContentProps<HMLoadedMath>) {
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
      {tex ? (
        <SizableText
          ref={mathRef}
          ai={isContentSmallerThanContainer ? 'center' : 'flex-start'}
          ac={isContentSmallerThanContainer ? 'center' : 'flex-start'}
          dangerouslySetInnerHTML={{__html: tex}}
        />
      ) : null}
    </YStack>
  )
}

function getSourceType(name?: string) {
  if (!name) return
  const nameArray = name.split('.')
  return `video/${nameArray[nameArray.length - 1]}`
}

export function useBlockCitations(blockId?: string) {
  const context = useDocContentContext()

  let citations = useMemo(() => {
    if (!context.citations?.length) return []
    return context.citations.filter((c) => {
      // if (c.source.id.type !== 'd') return false
      return c.targetFragment && c.targetFragment.blockId == blockId
    })
  }, [blockId, context.citations])

  return {
    docCitations: citations.filter((c) => c.source.id.type === 'd'),
    commentCitations: citations.filter((c) => c.source.id.type === 'c'),
  }
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
  onHoverIn,
  onHoverOut,
}: ContentHoverProps & {
  children: string
  entityId: UnpackedHypermediaId
}) {
  const buttonProps = useRouteLink({key: 'document', id: entityId})
  return (
    <ButtonText
      {...buttonProps}
      onHoverIn={() => onHoverIn?.(entityId)}
      onHoverOut={() => onHoverOut?.(entityId)}
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

function EmbedWrapper({
  id,
  hideBorder = false,
  children,
}: React.PropsWithChildren<{
  id: UnpackedHypermediaId
  hideBorder?: boolean
}>) {
  const docContext = useDocContentContext()
  const {originHomeId} = useUniversalAppContext()
  const navigate = useNavigate()
  return (
    <YStack
      width="100%"
      borderRadius={0}
      borderLeftWidth={hideBorder ? 0 : 3}
      borderLeftColor={hideBorder ? '$colorTransparent' : '$brand5'}
      onPress={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const destUrl = createWebHMUrl(id.type, id.uid, {
          hostname: null,
          blockRange: id.blockRange,
          blockRef: id.blockRef,
          version: id.version,
          latest: id.latest,
          path: id.path,
          originHomeId,
        })
        navigate(destUrl)
      }}
      onHoverIn={() => docContext?.onHoverIn?.(id)}
      onHoverOut={() => docContext?.onHoverOut?.(id)}
    >
      {children}
    </YStack>
  )
}

export type ContentHoverProps = {
  onHoverIn?: (id: UnpackedHypermediaId) => void
  onHoverOut?: (id: UnpackedHypermediaId) => void
}

export function EmbedDocument({
  embed,
  ...props
}: {embed: HMLoadedEmbed} & ContentHoverProps) {
  if (embed.view == 'Card') {
    return <EmbedDocumentCard {...props} embed={embed} />
  } else {
    return <EmbedDocumentContent {...props} embed={embed} />
  }
}

export function EmbedComment(props: {embed: HMLoadedEmbed}) {
  return <SizableText>Comment</SizableText>
}

function DocInlineEmbed({
  embed,
  onHoverIn,
  onHoverOut,
}: {embed: HMLoadedInlineEmbedNode} & ContentHoverProps) {
  if (!embed.id) throw new Error('Invalid props at DocInlineEmbed (embed.id)')
  return (
    <InlineEmbedButton
      entityId={embed.id}
      // parentBlockId={props.parentBlockId}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
    >
      {`@${embed.text || '...'}`}
    </InlineEmbedButton>
  )
}

export function EmbedDocumentCard({
  embed,
  ...props
}: {embed: HMLoadedEmbed} & ContentHoverProps) {
  return (
    <EmbedWrapper id={embed.embedId} hideBorder>
      <HMDocCard
        isWeb
        entity={{
          id: embed.embedId,
          document: embed.document,
        }}
        docId={props.id}
        accountsMetadata={Object.fromEntries(
          embed.authors
            .map((d) => d.data)
            .filter((d) => !!d)
            .map((authorDoc) => [
              authorDoc.id.uid,
              {
                id: authorDoc.id,
                metadata: authorDoc.document?.metadata,
              },
            ])
            .filter(([_, metadata]) => !!metadata),
        )}
      />
    </EmbedWrapper>
  )
}

export function EmbedDocumentContent({
  embed,
  ...props
}: {embed: HMLoadedEmbed} & ContentHoverProps) {
  const [showReferenced, setShowReferenced] = useState(false)
  const {entityId} = useDocContentContext()
  if (props.id && entityId && props.id === entityId.id) {
    return (
      // avoid recursive embeds!
      <SizableText color="$color9">
        Embed: Parent document (skipped)
      </SizableText>
    )
  }
  // return <div>{JSON.stringify(doc.data)}</div>;
  return (
    <ContentEmbed
      props={props}
      isLoading={doc.isLoading}
      showReferenced={showReferenced}
      onShowReferenced={setShowReferenced}
      document={doc.data?.document}
      EmbedWrapper={EmbedWrapper}
      parentBlockId={props.parentBlockId}
      renderOpenButton={
        () => null
        //   <Button
        //     size="$2"
        //     icon={ArrowUpRightSquare}
        //     onPress={() => {
        //       if (!props.id) return
        //       navigate({
        //         key: 'document',
        //         id: props,
        //       })
        //     }}
        //   >
        //     Open Document
        //   </Button>
      }
    />
  )
}

export function BlockContentQuery({block}: BlockContentProps<HMLoadedQuery>) {
  const query = block.attributes.query
  const includes = query.includes || []
  const id =
    includes[0].space &&
    hmId('d', includes[0].space, {
      path: includes[0].path ? includes[0].path.split('/') : null,
      latest: true,
    })
  if (!id) return <BlankQueryBlockMessage message="Empty Query" />

  if (includes.length == 0) return null
  const queryInclude = includes[0]
  if (!queryInclude || includes.length !== 1)
    return (
      <ErrorBlock message="Only one QueryBlock.attributes.query.includes is supported for now" />
    )
  if (!queryInclude.space) return <ErrorBlock message="Empty Query" />

  const queryResults = supportQueries?.find((q) => {
    if (q.in.uid !== queryInclude.space) return false
    const path = hmIdPathToEntityQueryPath(q.in.path)

    let comparePath =
      queryInclude.path?.[0] === '/'
        ? queryInclude.path
        : queryInclude.path
        ? `/${queryInclude.path}`
        : ''
    if (path !== comparePath) return false
    if (q.mode !== queryInclude.mode) return false
    return true
  })

  let displayItems = queryBlockSortedItems({
    entries: queryResults?.results || [],
    sort: block.attributes.query.sort || [{term: 'UpdateTime', reverse: false}],
  })

  if (block.attributes.query.limit) {
    displayItems = displayItems.slice(0, block.attributes.query.limit)
  }

  const DataComponent =
    block.attributes.style == 'List' ? QueryListStyle : QueryStyleCard

  return <DataComponent block={block} items={displayItems} />
}

function QueryStyleCard({
  block,
  items,
}: {
  block: HMBlockQuery
  items: Array<HMDocumentInfo>
}) {
  const ctx = useDocContentContext()

  function getEntity(path: string[]) {
    return supportDocuments?.find(
      (entity) => entity?.id?.path?.join('/') === path?.join('/'),
    )
  }
  const columnProps = useMemo(() => {
    switch (block.attributes.columnCount) {
      case 2:
        return {
          flexBasis: '100%',
          $gtSm: {flexBasis: '50%'},
          $gtMd: {flexBasis: '50%'},
        } as StackProps
      case 3:
        return {
          flexBasis: '100%',
          $gtSm: {flexBasis: '50%'},
          $gtMd: {flexBasis: '33.333%'},
        } as StackProps
      default:
        return {
          flexBasis: '100%',
          $gtSm: {flexBasis: '100%'},
          $gtMd: {flexBasis: '100%'},
        } as StackProps
    }
  }, [block.attributes.columnCount])

  const firstItem = block.attributes.banner ? items[0] : null
  const restItems = block.attributes.banner ? items.slice(1) : items

  const accountsMetadata =
    ctx.supportDocuments?.reduce((acc, d) => {
      if (!d.document?.metadata) return acc
      if (d.id.path?.length) return acc
      acc[d.id.uid] = {
        id: d.id,
        metadata: d.document.metadata,
      }
      return acc
    }, {} as HMAccountsMetadata) || {}

  return (
    <YStack width="100%">
      {firstItem ? (
        <HMDocCardBanner
          item={firstItem}
          entity={getEntity(firstItem.path)}
          key={firstItem.path.join('/')}
          accountsMetadata={accountsMetadata}
        />
      ) : null}
      {restItems?.length ? (
        <XStack
          f={1}
          flexWrap="wrap"
          marginHorizontal="$-3"
          justifyContent="center"
        >
          {restItems.map((item) => {
            const id = hmId('d', item.account, {
              path: item.path,
              latest: true,
            })
            return (
              <YStack
                {...columnProps}
                p="$3"
                key={item.account + '/' + item.path.join('/')}
              >
                <HMDocCard
                  docId={id}
                  entity={getEntity(item.path)}
                  key={item.path.join('/')}
                  accountsMetadata={accountsMetadata}
                  flexBasis="100%"
                  $gtSm={{flexBasis: '100%'}}
                  $gtMd={{flexBasis: '100%'}}
                />
              </YStack>
            )
          })}
        </XStack>
      ) : null}
      {items.length == 0 ? (
        <BlankQueryBlockMessage message="No Documents found in this Query Block." />
      ) : null}
    </YStack>
  )
}

function QueryListStyle({
  block,
  items,
}: {
  block: HMBlockQuery
  items: Array<HMDocumentInfo>
}) {
  const navigate = useNavigate()

  return (
    <YStack gap="$3" w="100%">
      {items?.map((item) => {
        const id = hmId('d', item.account, {
          path: item.path,
          latest: true,
        })
        const icon =
          id.path?.length == 0 || item.metadata?.icon ? (
            <HMIcon size={28} id={id} metadata={item.metadata} />
          ) : null
        return (
          <Button
            borderWidth={0}
            backgroundColor="$colorTransparent"
            hoverStyle={{
              backgroundColor: '$color5',
            }}
            elevation="$1"
            paddingHorizontal={16}
            paddingVertical="$1"
            h={60}
            icon={icon}
            onPress={() => {
              navigate(
                createWebHMUrl(id.type, id.uid, {
                  hostname: null,
                  blockRange: id.blockRange,
                  blockRef: id.blockRef,
                  version: id.version,
                  latest: id.latest,
                  path: id.path,
                }),
              )
            }}
          >
            <XStack gap="$2" alignItems="center" flex={1} paddingVertical="$2">
              <SizableText
                fontWeight="bold"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
                overflow="hidden"
              >
                {item.metadata.name}
              </SizableText>
            </XStack>
            <SizableText size="$1" color="$color10">
              {formattedDate(item.updateTime)}
            </SizableText>
          </Button>
        )
      })}
    </YStack>
  )
}
