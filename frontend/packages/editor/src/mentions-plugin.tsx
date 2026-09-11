import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, hypermediaUrlToHref, useUniversalAppContext} from '@shm/shared'
import {getContactMetadata, getDocumentTitle} from '@shm/shared/content'
import {useDocumentActions} from '@shm/shared/document-actions-context'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useHighlighter} from '@shm/ui/highlight-context'
import {SizableText} from '@shm/ui/text'
import {Node} from '@tiptap/core'
import {Plugin} from '@tiptap/pm/state'
import {NodeViewWrapper, ReactNodeViewRenderer} from '@tiptap/react'
import './inline-embed.css'

/** Fallback text used when serializing an inline embed to the clipboard. */
export function inlineEmbedClipboardText(link: string): string {
  return link || ''
}

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
    renderHTML({node, HTMLAttributes}) {
      return [
        'a',
        {
          ...HTMLAttributes,
          href: HTMLAttributes.link,
          'data-inline-embed': HTMLAttributes.link,
          ...(node.attrs.mentionKind ? {'data-mention-kind': node.attrs.mentionKind} : {}),
        },
        inlineEmbedClipboardText(node.attrs.link),
      ]
    },
    renderText({node}) {
      return inlineEmbedClipboardText(node.attrs.link)
    },
    parseHTML() {
      return [
        {
          tag: `a[data-inline-embed]`,
          priority: 1000,
          getAttrs: (dom) => {
            if (dom instanceof HTMLElement) {
              var value = dom.getAttribute('data-inline-embed')
              const kind = dom.getAttribute('data-mention-kind')
              return {link: value, mentionKind: kind === 'account' || kind === 'document' ? kind : null}
            }
            return false
          },
        },
        {
          tag: `span[data-inline-embed]`,
          priority: 1000,
          getAttrs: (dom) => {
            if (dom instanceof HTMLElement) {
              var value = dom.getAttribute('data-inline-embed')
              const kind = dom.getAttribute('data-mention-kind')
              return {link: value, mentionKind: kind === 'account' || kind === 'document' ? kind : null}
            }
            return false
          },
        },
      ]
    },
    addAttributes() {
      return {
        mentionKind: {default: null, rendered: false},
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
  const {hmUrlHref, origin, originHomeId} = useUniversalAppContext()
  const renderedHref =
    hypermediaUrlToHref(props.node.attrs.link, {
      hmUrlHref,
      origin,
      originHomeId,
    }) || props.node.attrs.link
  const isEditable = props.editor?.isEditable
  const wrapperProps = isEditable ? {} : {href: renderedHref}

  return (
    <NodeViewWrapper
      as={isEditable ? 'span' : 'a'}
      className={`inline-embed-token ${props.selected ? 'selected' : ''}`}
      data-inline-embed={props.node.attrs.link}
      data-mention-kind={props.node.attrs.mentionKind || undefined}
      {...wrapperProps}
    >
      <MentionToken
        value={props.node.attrs.link}
        mentionKind={props.node.attrs.mentionKind}
        selected={props.selected}
      />
    </NodeViewWrapper>
  )
}

/** Renders explicit mention identities while preserving legacy root-account references. */
export function MentionToken(props: {value: string; mentionKind?: 'account' | 'document'; selected?: boolean}) {
  const unpackedRef = unpackHmId(props.value)
  const profileAccountUid = unpackedRef?.path?.[0] === ':profile' ? unpackedRef.path[1] || unpackedRef.uid : null

  if (unpackedRef && props.mentionKind === 'document') {
    return <DocumentMention unpackedRef={unpackedRef} {...props} />
  } else if (profileAccountUid) {
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
  const entity = useResource(unpackedRef, {subscribed: true})
  const actions = useDocumentActions()
  const highlight = useHighlighter()
  const draft = actions.getDraft?.(unpackedRef)
  const publishedTitle =
    entity.data && 'document' in entity.data && entity.data.document ? getDocumentTitle(entity.data.document) : null
  const resolved = draft?.metadata?.name ?? publishedTitle
  return (
    <MentionText selected={selected} {...highlight(unpackedRef)}>
      {resolved || unpackedRef.id}
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
  const entity = useAccount(accountUid, {subscribe: true})
  const meta = getContactMetadata(accountUid, entity.data?.metadata, contacts)

  return (
    <MentionText selected={selected} {...highlight(highlightId)}>
      {meta.name.startsWith('@') ? meta.name : `@${meta.name}`}
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
