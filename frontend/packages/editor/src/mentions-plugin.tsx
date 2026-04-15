import {hmId} from '@shm/shared'
import {useUniversalAppContext} from '@shm/shared'
import {getContactMetadata, getDocumentTitle} from '@shm/shared/content'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useHighlighter} from '@shm/ui/highlight-context'
import {SizableText} from '@shm/ui/text'
import {Node} from '@tiptap/core'
import {Plugin} from '@tiptap/pm/state'
import {NodeViewWrapper, ReactNodeViewRenderer} from '@tiptap/react'
import './inline-embed.css'

/** Creates the TipTap Node for rendering inline-embed mentions in the document. */
export function createInlineEmbedNode() {
  const InlineEmbedNode = Node.create({
    atom: true,
    name: 'inline-embed',
    group: 'inline',
    inline: true,
    addNodeView() {
      return ReactNodeViewRenderer(InlineEmbedNodeComponent)
    },
    renderHTML({HTMLAttributes}) {
      return ['span', {...HTMLAttributes, 'data-inline-embed': HTMLAttributes.link}]
    },
    parseHTML() {
      return [
        {
          tag: `span[data-inline-embed]`,
          getAttrs: (dom) => {
            if (dom instanceof HTMLElement) {
              var value = dom.getAttribute('data-inline-embed')
              return {link: value}
            }
            return false
          },
        },
      ]
    },
    addAttributes() {
      return {
        link: {
          default: '',
        },
      }
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleKeyDown(view, event) {
              if (view.state.selection.from === view.state.selection.to) {
                const resolved = view.state.doc.resolve(view.state.selection.from)
                if (
                  resolved.nodeBefore == null &&
                  resolved.nodeAfter?.type.name === 'inline-embed' &&
                  event.code === `Key${event.key.toUpperCase()}`
                ) {
                  view.dispatch(view.state.tr.insertText(event.key))
                  return true
                }
              }
              return false
            },
          },
        }),
      ]
    },
  })

  return InlineEmbedNode
}

function InlineEmbedNodeComponent(props: any) {
  return (
    <NodeViewWrapper
      as="span"
      className={`inline-embed-token ${props.selected ? 'selected' : ''}`}
      data-inline-embed={props.node.attrs.link}
    >
      <MentionToken value={props.node.attrs.link} selected={props.selected} />
    </NodeViewWrapper>
  )
}

export function MentionToken(props: {value: string; selected?: boolean}) {
  const unpackedRef = unpackHmId(props.value)
  const profileAccountUid = unpackedRef?.path?.[0] === ':profile' ? unpackedRef.path[1] || unpackedRef.uid : null

  if (profileAccountUid) {
    return <ContactMention accountUid={profileAccountUid} highlightId={hmId(profileAccountUid)} {...props} />
  } else if (unpackedRef && unpackedRef.path && unpackedRef.path.length > 0) {
    return <DocumentMention unpackedRef={unpackedRef} {...props} />
  } else if (unpackedRef) {
    return <ContactMention accountUid={unpackedRef.uid} highlightId={unpackedRef} {...props} />
  } else {
    console.log('=== MENTION ERROR', props)
    return <MentionText>ERROR</MentionText>
  }
}

function DocumentMention({unpackedRef, selected}: {unpackedRef: UnpackedHypermediaId; selected?: boolean}) {
  const entity = useResource(unpackedRef)
  const highlight = useHighlighter()
  return (
    <MentionText selected={selected} {...highlight(unpackedRef)}>
      {entity.data && 'document' in entity.data && entity.data.document
        ? getDocumentTitle(entity.data.document)
        : unpackedRef.id}
    </MentionText>
  )
}

function ContactMention({
  accountUid,
  highlightId,
  selected,
}: {
  accountUid: string
  highlightId: UnpackedHypermediaId
  selected?: boolean
}) {
  const {contacts} = useUniversalAppContext()
  const highlight = useHighlighter()
  const entity = useAccount(accountUid)

  return (
    <MentionText selected={selected} {...highlight(highlightId)}>
      {getContactMetadata(accountUid, entity.data?.metadata, contacts).name}
    </MentionText>
  )
}

export function MentionText(props: any) {
  return (
    <SizableText
      weight="bold"
      className="mention-text link text-link hover:text-link-hover px-0.5 pb-0.5"
      style={{
        fontSize: 'inherit',
        fontFamily: 'inherit',
      }}
      {...props}
    >
      {props.children}
    </SizableText>
  )
}
