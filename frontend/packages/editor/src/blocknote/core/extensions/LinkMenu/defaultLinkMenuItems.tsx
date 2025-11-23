import {
  createHMUrl,
  isHypermediaScheme,
  isPublicGatewayLink,
  normalizeHmId,
  StateStream,
  UnpackedHypermediaId,
} from '@shm/shared'
import {
  CircleDot,
  File as FileIcon,
  ImageIcon,
  Instagram,
  Link,
  PanelBottom,
  Quote,
  TwitterXIcon,
  VideoIcon,
} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {Fragment, Mark, Node} from '@tiptap/pm/model'
import {HMBlockSchema} from '../../../../schema'
import {youtubeParser} from '../../../../utils'
import {BlockNoteEditor} from '../../BlockNoteEditor'
import {getBlockInfoFromPos} from '../Blocks/helpers/getBlockInfoFromPos'
import {LinkMenuItem} from './LinkMenuItem'

export function getLinkMenuItems({
  isLoading,
  hmId,
  media,
  sourceUrl,
  fileName,
  title,
  type,
  gwUrl,
}: {
  isLoading: boolean // true is spinner needs to be shown
  hmId?: UnpackedHypermediaId | null // if the link is an embeddable link
  media?: string // type of media block if link points to a media file
  sourceUrl?: string // the inserted link into the editor. needed to correctly replace the link with block
  fileName?: string // file name if any
  title?: string | null // resource title if any
  type?: 'Document' | 'Comment' | null // resource type if any
  gwUrl: StateStream<string>
}) {
  let linkMenuItems: LinkMenuItem[] = []

  if (sourceUrl && !isHypermediaScheme(sourceUrl)) {
    linkMenuItems = [
      {
        key: 'link',
        name: 'Link',
        disabled: false,
        icon: <Link size={18} />,
        execute: (editor: BlockNoteEditor<HMBlockSchema>, ref: string) => {
          let insertedText = title ? title : sourceUrl
          const {state, schema, view} = editor._tiptapEditor
          const {selection} = state
          const pos = selection.from - (title ? title.length : sourceUrl.length)
          view.dispatch(
            view.state.tr
              .deleteRange(pos, pos + insertedText.length)
              .insertText(insertedText, pos)
              .addMark(
                pos,
                pos + insertedText.length,
                schema.mark('link', {
                  href: sourceUrl,
                }),
              ),
          )
        },
      },
      {
        key: 'button',
        name: 'Button',
        disabled: false,
        icon: <CircleDot size={18} />,
        execute: (editor: BlockNoteEditor<HMBlockSchema>, ref: string) => {
          const {state, schema} = editor._tiptapEditor
          const {selection} = state
          if (!selection.empty) return
          const node = schema.nodes.button.create({
            url: sourceUrl,
            name: sourceUrl,
          })

          insertNode(editor, sourceUrl, node)
        },
      },
      ...linkMenuItems,
    ]
  }

  if (isLoading) {
    const loadingItem = {
      name: 'Checking link...',
      key: 'loading',
      // hm://z6Mkj5NQAYGQSLRAV2L6g4R2LC8D2FL47XW5miJsPaRvkerg?v=bafy2bzacecwv74orbeuwfdzyvnbyzqnwzdn3gorznjku7ythcyyj6aqqktcqu
      icon: <Spinner size="small" />,
      // size="small"
      disabled: true,
      execute: (_editor: BlockNoteEditor<HMBlockSchema>, _ref: string) => {},
    }

    linkMenuItems = [loadingItem, ...linkMenuItems]
  } else {
    if (hmId) {
      linkMenuItems = [
        {
          // name: `Link as "${docTitle}"`,
          key: 'link',
          name: 'Link',
          disabled: false,
          icon: <Link size={18} />,
          execute: (editor: BlockNoteEditor<HMBlockSchema>, ref: string) => {
            // this is the default behavior of HM links and is already applied by this time
          },
        },
        {
          key: 'embed',
          name: 'Embed',
          disabled: false,
          icon: <FileIcon size={18} />,
          execute: (editor: BlockNoteEditor<HMBlockSchema>, ref: string) => {
            const {state, schema} = editor._tiptapEditor
            const {selection} = state
            if (!selection.empty) return
            const hmRef = createHMUrl(hmId)
            const node = schema.nodes.embed.create(
              {
                url: hmRef,
                view: 'Content',
              },
              schema.text(' '),
            )

            insertNode(editor, sourceUrl || hmRef, node)
          },
        },
      ]

      if (type === 'Document') {
        linkMenuItems.push({
          key: 'card',
          name: 'Card',
          disabled: false,
          icon: <PanelBottom size={18} />,
          execute: (editor: BlockNoteEditor<HMBlockSchema>, ref: string) => {
            const {state, schema} = editor._tiptapEditor
            const {selection} = state
            if (!selection.empty) return
            const hmRef = createHMUrl(hmId)
            const node = schema.nodes.embed.create(
              {
                url: hmRef,
                view: 'Card',
              },
              schema.text(' '),
            )

            insertNode(editor, sourceUrl || hmRef, node)
          },
        })
        linkMenuItems.push({
          // name: `Mention "${docTitle}"`,
          key: 'mention',
          name: 'Mention',
          disabled: false,
          icon: <Quote size={18} />,
          execute: (editor: BlockNoteEditor<HMBlockSchema>, ref: string) => {
            let link = sourceUrl || ref
            if (isPublicGatewayLink(link, gwUrl) || isHypermediaScheme(link)) {
              const hmId = normalizeHmId(link, gwUrl)
              if (!hmId) return
              link = hmId
            }
            const {state, schema} = editor._tiptapEditor
            const {selection} = state
            if (!selection.empty) return
            const node = schema.nodes['inline-embed'].create(
              {
                link,
              },
              schema.text(' '),
            )
            insertMentionNode(editor, link, title || '?', node)
          },
        })
        linkMenuItems.push({
          key: 'button',
          name: 'Button',
          disabled: false,
          icon: <CircleDot size={18} />,
          execute: (editor: BlockNoteEditor<HMBlockSchema>, ref: string) => {
            const {state, schema} = editor._tiptapEditor
            const {selection} = state
            if (!selection.empty) return
            const node = schema.nodes.button.create({
              url: sourceUrl,
              name: title,
            })
            insertNode(editor, sourceUrl || ref, node)
          },
        })
      }
    } else if (media) {
      let mediaIcon
      switch (media) {
        case 'twitter':
          mediaIcon = <TwitterXIcon width={18} height={18} />
          break
        case 'instagram':
          mediaIcon = <Instagram width={18} height={18} />
          break
        case 'video':
          mediaIcon = <VideoIcon width={18} height={18} />
          break
        case 'image':
          mediaIcon = <ImageIcon width={18} height={18} />
          break
        default:
          mediaIcon = <FileIcon width={18} height={18} />
          break
      }
      const mediaNames: Record<string, string> = {
        twitter: 'X.com embed',
        instagram: 'Instagram embed',
      }
      const mediaItem = {
        name:
          mediaNames[media] ?? media.charAt(0).toUpperCase() + media.slice(1),
        disabled: false,
        icon: mediaIcon,
        execute: (editor: BlockNoteEditor<HMBlockSchema>, link: string) => {
          const {state, schema} = editor._tiptapEditor
          const {selection} = state
          if (!selection.empty) return
          let embedUrl = ''
          if (media === 'video') {
            let videoUrl = link ? link : sourceUrl ? sourceUrl : ''
            if (videoUrl.includes('youtu.be') || videoUrl.includes('youtube')) {
              let ytId = youtubeParser(videoUrl)
              if (ytId) {
                videoUrl = `https://www.youtube.com/embed/${ytId}`
              } else {
                videoUrl = ''
              }
            } else if (videoUrl.includes('vimeo')) {
              const urlArray = videoUrl.split('/')
              videoUrl =
                'https://player.vimeo.com/video/' +
                urlArray[urlArray.length - 1]
            }
            embedUrl = videoUrl
          }

          const node =
            media !== 'twitter' && media !== 'instagram'
              ? schema.nodes[media].create({
                  url: embedUrl ? embedUrl : '',
                  src: embedUrl ? '' : link ? link : sourceUrl ? sourceUrl : '',
                  name: fileName ? fileName : '',
                })
              : schema.nodes['web-embed'].create({
                  url: link ? link : sourceUrl,
                })

          insertNode(editor, link ? link : sourceUrl ? sourceUrl : '', node)
        },
      }

      // @ts-expect-error
      linkMenuItems = [mediaItem, ...linkMenuItems]
    }
  }

  return linkMenuItems
}

function insertNode(
  editor: BlockNoteEditor<HMBlockSchema>,
  ref: string,
  node: Node,
) {
  const {state, schema, view} = editor._tiptapEditor
  const {selection} = state
  const {$from} = selection
  const blockInfo = getBlockInfoFromPos(state, selection.$anchor.pos)
  let tr = state.tr

  // If inserted link inline with other text (child count will be more than 1)
  if (blockInfo.blockContent.node.content.childCount > 1) {
    const $pos = state.doc.resolve($from.pos)
    let linkStartPos: number | null = null
    let linkEndPos: number | null = null
    const beforeLinkContent: Node[] = []
    const afterLinkContent: Node[] = []

    // Find the actual link mark position by iterating through descendants
    const cursorPos = $from.pos
    // @ts-ignore
    $pos.parent.descendants((childNode, pos, _parent, index) => {
      const linkMark = childNode.marks?.find(
        (mark: Mark) => mark.type.name === 'link' && mark.attrs.href === ref,
      )

      const childStartPos =
        index === 0 ? $pos.start() + pos - 2 : $pos.start() + pos
      const childEndPos = childStartPos + (childNode.text?.length || 0)

      // Check if this link contains the cursor position
      if (linkMark && linkStartPos === null) {
        // Check if cursor is within this link's range
        if (cursorPos >= childStartPos && cursorPos <= childEndPos) {
          linkStartPos = childStartPos
          linkEndPos = childEndPos
        } else {
          if (childNode.type.name === 'text') {
            beforeLinkContent.push(childNode)
          }
          return
        }
      }

      if (linkStartPos === null) {
        // Content before the link
        if (childNode.type.name === 'text') {
          beforeLinkContent.push(childNode)
        }
      } else if (
        linkStartPos !== null &&
        linkEndPos !== null &&
        childStartPos >= linkEndPos
      ) {
        // Content after the link
        if (childNode.type.name === 'text') {
          afterLinkContent.push(childNode)
        }
      }
    })

    if (linkStartPos !== null && linkEndPos !== null) {
      // Split the text
      const blockContentStartPos = blockInfo.blockContent.beforePos
      const blockContentEndPos = blockInfo.blockContent.afterPos

      // Replace the current block content with only text before the link
      const beforeLinkNode =
        beforeLinkContent.length > 0
          ? schema.node(
              blockInfo.blockContentType,
              blockInfo.blockContent.node.attrs,
              beforeLinkContent,
            )
          : null

      if (beforeLinkNode) {
        tr = tr.replaceWith(
          blockContentStartPos,
          blockContentEndPos,
          beforeLinkNode,
        )
      } else {
        // If no content before, replace with empty paragraph
        const paragraphNode = schema.nodes.paragraph.create()
        tr = tr.replaceWith(
          blockContentStartPos,
          blockContentEndPos,
          paragraphNode,
        )
      }

      // Insert the embed block after the current block
      const nextBlockPos = blockInfo.block.afterPos
      const mappedNextBlockPos = tr.mapping.map(nextBlockPos)
      const embedBlock = state.schema.nodes['blockContainer'].createAndFill()!
      tr = tr.insert(mappedNextBlockPos, embedBlock)

      // Resolve position in the updated document to insert the embed node
      const $embedBlockPos = tr.doc.resolve(mappedNextBlockPos + 1)
      const embedBlockContentPos = $embedBlockPos.pos
      tr = tr.replaceWith(
        $embedBlockPos.before($embedBlockPos.depth),
        embedBlockContentPos + 1,
        node,
      )

      // If there's text after the link, insert it in a new block after the embed
      if (afterLinkContent.length > 0) {
        const afterLinkNode = schema.node(
          blockInfo.blockContentType,
          blockInfo.blockContent.node.attrs,
          afterLinkContent,
        )

        // Calculate position after the embed block by resolving it in the updated document
        const currentDoc = tr.doc
        const insertedEmbedBlock = tr.doc.nodeAt(mappedNextBlockPos)
        if (insertedEmbedBlock) {
          const embedBlockAfterPos =
            mappedNextBlockPos + insertedEmbedBlock.nodeSize
          const afterTextBlock =
            state.schema.nodes['blockContainer'].createAndFill()!
          tr = tr.insert(embedBlockAfterPos, afterTextBlock)

          // Insert the after-link text into the new block (resolve position after inserting afterTextBlock)
          const insertedAfterTextBlock = tr.doc.nodeAt(embedBlockAfterPos)
          if (insertedAfterTextBlock) {
            const $afterTextBlockPos = tr.doc.resolve(embedBlockAfterPos + 1)
            const afterTextBlockContentPos = $afterTextBlockPos.pos
            tr = tr.replaceWith(
              $afterTextBlockPos.before($afterTextBlockPos.depth),
              afterTextBlockContentPos + 1,
              afterLinkNode,
            )
          }
        }
      }
    } else {
      // Fallback: if can't find the link, replace the whole block
      tr = tr.replaceWith($from.before($from.depth), $from.pos, node)
    }
  } else {
    tr = tr.replaceWith($from.before($from.depth), $from.pos, node)
  }
  view.dispatch(tr)
}

function insertMentionNode(
  editor: BlockNoteEditor<HMBlockSchema>,
  link: string,
  title: string,
  node: Node,
) {
  const {state, view} = editor._tiptapEditor
  const {selection} = state
  const {$from} = selection
  let tr = state.tr

  // If inserted link inline with other text (child count will be more than 1)

  const $pos = state.doc.resolve($from.pos)
  let originalStartContent = state.doc.cut($pos.start(), $pos.pos - link.length)

  view.dispatch(
    tr
      .insert($pos.pos, Fragment.fromArray([node, view.state.schema.text(' ')]))
      .deleteRange($pos.pos - title.length, $pos.pos),
  )
  // let originalLastContent = state.doc.cut($pos.pos, $pos.end())
  // const originalContent: Node[] = []
  // originalStartContent.descendants((childNode) => {
  //   if (childNode.type.name === 'text') originalContent.push(childNode)
  // })
  // originalLastContent.descendants((childNode) => {
  //   if (childNode.type.name === 'text') originalContent.push(childNode)
  // })
  // const originalNode = schema.node(
  //   block.contentType,
  //   block.contentNode.attrs,
  //   originalContent,
  // )

  // const newMention = state.schema.nodes['inline-embed'].create({
  //   ref
  // })!

  // view.dispatch(
  //   view.state.tr.replaceWith(
  //     range.from,
  //     range.to,
  //     Fragment.fromArray([node, view.state.schema.text(' ')]),
  //   ),
  // )

  // view.dispatch(tr)
}
