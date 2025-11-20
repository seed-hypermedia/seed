import {
  AutocompletePopup,
  createAutoCompletePlugin,
} from '@shm/editor/autocomplete'
import {useUniversalAppContext} from '@shm/shared'
import {getContactMetadata, getDocumentTitle} from '@shm/shared/content'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useHighlighter} from '@shm/ui/highlight-context'
import {SizableText} from '@shm/ui/text'
import {Node} from '@tiptap/core'
import {NodeViewWrapper, ReactNodeViewRenderer} from '@tiptap/react'
import ReactDOM from 'react-dom/client'
import './inline-embed.css'
/**
 * we need
 * - a inline atom node to render the inline references
 * - a plugin that captures the keys pressed and opens the suggestions menu when we need it
 * - an autocomplete plugin that filters the list when we type after the trigger
 * - serialize/deserialize mentions to the backend
 *
 */

var inlineEmbedPopupElement: HTMLElement | null = null
var popupRoot: ReactDOM.Root | null = null

function getOrCreatePopupElement() {
  if (typeof document === 'undefined') return null

  if (!inlineEmbedPopupElement) {
    inlineEmbedPopupElement = document.createElement('div')
    inlineEmbedPopupElement.style.position = 'absolute'
    // inlineEmbedPopupElement.style.pointerEvents = 'none'
    inlineEmbedPopupElement.style.zIndex = '9999'
    document.body.append(inlineEmbedPopupElement)
    popupRoot = ReactDOM.createRoot(inlineEmbedPopupElement)
  }

  return popupRoot
}

export function createInlineEmbedNode(bnEditor: any) {
  let {nodes, plugins} = createAutoCompletePlugin({
    nodeName: 'inline-embed',
    triggerCharacter: '@',
    renderPopup: (state, actions) => {
      const root = getOrCreatePopupElement()
      if (root) {
        root.render(
          <AutocompletePopup
            editor={bnEditor}
            state={state}
            actions={actions}
          />,
        )
      }
    },
  })

  const InlineEmbedNode = Node.create({
    atom: nodes['inline-embed'].atom,
    name: 'inline-embed',
    group: 'inline',
    inline: nodes['inline-embed'].inline,
    addNodeView() {
      return ReactNodeViewRenderer(InlineEmbedNodeComponent)
    },
    renderHTML({HTMLAttributes}) {
      return [
        'span',
        {...HTMLAttributes, 'data-inline-embed': HTMLAttributes.link},
      ]
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
      return plugins
    },
  })

  return InlineEmbedNode
}

function InlineEmbedNodeComponent(props: any) {
  // console.log('InlineEmbedNodeComponent props', props)
  return (
    <NodeViewWrapper
      className={`inline-embed-token ${props.selected ? 'selected' : ''}`}
      data-inline-embed={props.node.attrs.link}
    >
      <MentionToken value={props.node.attrs.link} selected={props.selected} />
    </NodeViewWrapper>
  )
}

export function MentionToken(props: {value: string; selected?: boolean}) {
  // console.log('MentionToken props', props)
  const unpackedRef = unpackHmId(props.value)

  if (unpackedRef && unpackedRef.path && unpackedRef.path.length > 0) {
    return <DocumentMention unpackedRef={unpackedRef} {...props} />
  } else if (unpackedRef) {
    return <ContactMention unpackedRef={unpackedRef} {...props} />
  } else {
    console.log('=== MENTION ERROR', props)
    return <MentionText>ERROR</MentionText>
  }
}

function DocumentMention({
  unpackedRef,
  selected,
}: {
  unpackedRef: UnpackedHypermediaId
  selected?: boolean
}) {
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
  unpackedRef,
  selected,
}: {
  unpackedRef: UnpackedHypermediaId
  selected?: boolean
}) {
  const {contacts} = useUniversalAppContext()
  const highlight = useHighlighter()
  const entity = useAccount(unpackedRef.uid)

  return (
    <MentionText selected={selected} {...highlight(unpackedRef)}>
      {
        getContactMetadata(unpackedRef.uid, entity.data?.metadata, contacts)
          .name
      }
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
