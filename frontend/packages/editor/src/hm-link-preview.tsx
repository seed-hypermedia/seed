import {
  getDocumentTitle,
  HMDocument,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {useHighlighter} from '@shm/ui/highlight-context'
import {SizableText} from '@shm/ui/text'
import {Fragment, Node} from '@tiptap/pm/model'
import {useEffect, useMemo, useState} from 'react'
import {Pencil} from '../../ui/src/icons'
import {
  BlockNoteEditor,
  getBlockInfoFromPos,
  HyperlinkToolbarProps,
} from './blocknote'
import {getNodeById} from './blocknote/core/api/util/nodeUtil'
import {HypermediaLinkForm} from './hm-link-form'
import {HMBlockSchema} from './schema'

export function HypermediaLinkPreview(
  props: HyperlinkToolbarProps & {
    url: string
    openUrl: (url?: string | undefined, newWindow?: boolean | undefined) => void
    stopEditing: boolean
    forceEditing?: boolean
    formComponents: () => React.JSX.Element
    type: 'link' | 'inline-embed' | 'embed' | 'card' | 'button'
    setHovered?: (hovered: boolean) => void
    toolbarProps?: {
      alignment?: 'flex-start' | 'center' | 'flex-end'
      view?: string
      [key: string]: any
    }
  },
) {
  const [isEditing, setIsEditing] = useState(props.forceEditing || false)
  const unpackedRef = useMemo(() => unpackHmId(props.url), [props.url])

  const entity = useResource(unpackedRef || undefined)
  // console.log('entity', entity)
  const document =
    entity.data?.type === 'document' ? entity.data.document : undefined
  useEffect(() => {
    if (props.stopEditing && isEditing) {
      setIsEditing(false)
    }
  }, [props.stopEditing, isEditing])
  const highlight = useHighlighter()

  function handleChangeBlockType(type: string) {
    const tiptap = props.editor._tiptapEditor
    const {state, view} = tiptap
    const unpackedRef = unpackHmId(props.url)
    const schema = state.schema

    const getTitle = () => {
      if (['inline-embed', 'embed'].includes(props.type)) {
        const title = getTitleFromEntity(unpackedRef, document)
        return title || props.text || props.url
      }
      return props.text || props.url
    }

    const title = getTitle()

    if (type === 'link') {
      const node = schema.text(title, [
        schema.marks['link'].create({href: props.url}),
      ])
      insertNode(
        props.editor,
        props.id,
        props.url,
        props.text,
        props.type,
        node,
      )
    } else if (type === 'inline-embed') {
      const node = schema.nodes['inline-embed'].create(
        {link: props.url},
        schema.text(' '),
      )
      insertMentionNode(
        props.editor,
        props.text,
        node,
        props.id,
        props.type === 'link',
      )
    } else if (type === 'button') {
      const node = schema.nodes.button.create({url: props.url, name: title})
      insertNode(
        props.editor,
        props.id,
        props.url,
        props.text,
        props.type,
        node,
      )
    } else if (type === 'embed' || type === 'card' || type === 'comments') {
      const node = schema.nodes.embed.create(
        {
          url: props.url,
          view:
            type === 'embed'
              ? 'Content'
              : type === 'card'
              ? 'Card'
              : 'Comments',
        },
        schema.text(' '),
      )
      insertNode(
        props.editor,
        props.id,
        props.url,
        props.text,
        props.type,
        node,
      )
    }

    props.resetHyperlink()
  }

  return (
    <div
      data-testid="hm-link-preview"
      onMouseEnter={() => {
        props.editor.hyperlinkToolbar.stopHideTimer()
        props.setHovered?.(true)
      }}
      onMouseLeave={() => {
        props.setHovered?.(false)
        props.editor.hyperlinkToolbar.startHideTimer()
      }}
      className="link-preview-toolbar bg-muted flex max-h-[60vh] w-[320px] overflow-auto rounded-md p-2 shadow-lg"
    >
      {isEditing ? (
        <div data-testid="hm-link-form" className="flex flex-1 flex-col gap-2">
          {/* <SizableText fontWeight="700">{`${
            props.type.charAt(0).toUpperCase() + props.type.slice(1)
          } settings`}</SizableText> */}

          {props.formComponents && props.formComponents()}

          <HypermediaLinkForm
            editor={props.editor}
            id={props.id}
            url={props.url}
            text={props.text}
            updateLink={props.updateHyperlink}
            // @ts-expect-error
            openUrl={props.openUrl}
            onChangeType={(type) => {
              handleChangeBlockType(type)
            }}
            type={props.type}
            hasName={
              props.type !== 'embed' &&
              props.type !== 'inline-embed' &&
              props.type !== 'card'
            }
            hasSearch={props.type !== 'link'}
            resetLink={props.resetHyperlink}
            isHmLink={!!unpackedRef}
            toolbarProps={props.toolbarProps}
          />
        </div>
      ) : (
        <div className="flex w-full items-center justify-between gap-2 px-1">
          <div
            data-testid="hm-link-preview-open-button"
            className="flex flex-1 cursor-pointer overflow-hidden rounded-lg px-2 py-1.5 hover:bg-black/5 hover:opacity-80 active:bg-black/5 active:opacity-80 dark:hover:bg-white/10 dark:active:bg-white/10"
            onClick={() => props.openUrl(props.url)}
            {...highlight(unpackedRef)}
          >
            <SizableText
              size="lg"
              className="text-link hover:text-link-hover flex-1 truncate"
              data-testid="hm-link-preview-url"
            >
              {!!unpackedRef ? document?.metadata.name ?? props.url : props.url}
            </SizableText>
          </div>
          <Button
            data-testid="hm-link-preview-edit-button"
            className="hover:bg-black/5 hover:opacity-80 dark:hover:bg-white/10"
            onClick={() => setIsEditing(true)}
          >
            <Pencil className="size-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

function getTitleFromEntity(
  unpackedId?: UnpackedHypermediaId | null,
  document?: HMDocument | null,
) {
  if (!document || !unpackedId) return
  let title
  if (unpackedId.blockRef) {
    // @ts-ignore
    const block = document.content.find((block) => {
      if (block.block) {
        return block.block.id === unpackedId.blockRef
      }
    })
    if (block?.block?.type === 'Heading') {
      title = block.block.text
    }
  }
  if (!title) {
    title = getDocumentTitle(document)
  }
  return title
}

function insertNode(
  editor: BlockNoteEditor<HMBlockSchema>,
  selectedId: string,
  link: string,
  text: string,
  prevType: string,
  node: Node,
) {
  const {state, view} = editor._tiptapEditor
  const {posBeforeNode} = getNodeById(selectedId, state.doc)
  const blockInfo = getBlockInfoFromPos(state, posBeforeNode + 1)
  let tr = state.tr

  // If mention or link is inline with other text the child count will be more than 1
  if (blockInfo.blockContent.node.content.childCount > 1) {
    const $pos = state.doc.resolve(posBeforeNode + 1)
    let startPos = $pos.start()
    let endPos = $pos.end()
    let endContent = Fragment.empty

    // Set start and end positions to the link or mention bounds instead of the whole block content
    if (prevType === 'link') {
      // @ts-ignore
      $pos.parent.descendants((node, pos, _parent, index) => {
        if (node.marks.length > 0 && node.marks[0].attrs.href === link) {
          startPos = index === 0 ? $pos.start() + pos - 2 : $pos.start() + pos
          // endPos = index === 0 ? $pos.end() : $pos.start() + pos + text.length
          endPos = $pos.start() + pos + text.length
        } else if (startPos !== $pos.start() && endPos !== $pos.end()) {
          endContent = endContent.addToEnd(node)
        }
      })
    } else if (prevType === 'inline-embed') {
      // @ts-ignore
      $pos.parent.descendants((node, pos, _parent, index) => {
        if (node.type.name === 'inline-embed' && node.attrs.link === link) {
          startPos = index === 0 ? $pos.start() - 1 : $pos.start() + pos
          // endPos = index === 0 ? $pos.end() : $pos.start() + pos + 1
          endPos = $pos.start() + pos + 1
        } else if (startPos !== $pos.start() && endPos !== $pos.end()) {
          endContent = endContent.addToEnd(node)
        }
      })
    }

    tr = tr.replaceRangeWith(startPos, endPos, node)

    // const newBlock = state.schema.nodes['blockContainer'].createAndFill()!
    // const nextBlockPos = $pos.end() + 2
    // const nextBlockContentPos = nextBlockPos + 2
    // const $nextBlockPos = state.doc.resolve(nextBlockContentPos)
    // if (
    //   endContent.childCount &&
    //   !(
    //     endContent.childCount === 1 &&
    //     endContent.firstChild?.textContent.trim() === ''
    //   )
    // ) {
    //   tr = tr.insert(nextBlockPos, newBlock)

    //   const endNode = $pos.parent.copy(endContent)
    //   tr = tr.replaceWith(
    //     $nextBlockPos.before($nextBlockPos.depth),
    //     nextBlockContentPos + 1,
    //     endNode,
    //   )
    // }

    // tr = tr.insert(nextBlockPos, newBlock)
    // tr = tr.replaceWith(
    //   $nextBlockPos.before($nextBlockPos.depth),
    //   nextBlockContentPos + 1,
    //   node,
    // )
    // tr = tr.deleteRange(startPos, endPos)
  } else {
    const {posBeforeNode} = getNodeById(selectedId, state.doc)
    const blockInfo = getBlockInfoFromPos(state, posBeforeNode + 1)
    tr = tr.replaceRangeWith(
      blockInfo.blockContent.beforePos,
      blockInfo.blockContent.afterPos,
      node,
    )
  }
  view.dispatch(tr)
  editor._tiptapEditor.commands.focus()
}

function insertMentionNode(
  editor: BlockNoteEditor<HMBlockSchema>,
  name: string,
  node: Node,
  selectedId: string,
  inline: boolean,
) {
  const {state, view} = editor._tiptapEditor
  let tr = state.tr
  const {posBeforeNode} = getNodeById(selectedId, state.doc)

  const $pos = state.doc.resolve(posBeforeNode + 1)
  let startPos = $pos.start()
  let endPos = $pos.start() + 2

  if (inline) {
    let offset = 0
    // @ts-ignore
    $pos.parent.descendants((node, pos) => {
      if (node.marks.length > 0) {
        offset = pos
      }
    })
    startPos = startPos + offset
    endPos = startPos + name.length
  }

  view.dispatch(tr.replaceRangeWith(startPos, endPos, node))
}
