import {
  AutocompletePopup,
  createAutoCompletePlugin,
} from '@shm/editor/autocomplete'
import {getContactMetadata} from '@shm/shared/content'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useAccount} from '@shm/shared/models/entity'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useDocContentContext} from '@shm/ui/document-content'
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

var inlineEmbedPopupElement = document.createElement('div')
document.body.append(inlineEmbedPopupElement)
var popupRoot = ReactDOM.createRoot(inlineEmbedPopupElement)

export function createInlineEmbedNode(bnEditor: any) {
  let {nodes, plugins} = createAutoCompletePlugin({
    nodeName: 'inline-embed',
    triggerCharacter: '@',
    renderPopup: (state, actions) => {
      popupRoot.render(
        <AutocompletePopup editor={bnEditor} state={state} actions={actions} />,
      )
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

              console.log(`== node ~ parseHTML ~ value:`, value)
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
  return (
    <NodeViewWrapper
      className={`inline-embed-token${props.selected ? 'selected' : ''}`}
      data-inline-embed={props.node.attrs.link}
    >
      <MentionToken value={props.node.attrs.link} selected={props.selected} />
    </NodeViewWrapper>
  )
}

export function MentionToken(props: {value: string; selected?: boolean}) {
  const unpackedRef = unpackHmId(props.value)

  if (unpackedRef?.type == 'd') {
    return <DocumentMention unpackedRef={unpackedRef} {...props} />
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
  const {contacts} = useDocContentContext()
  const entity = useAccount(unpackedRef.uid)

  return (
    <MentionText selected={selected}>
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
      color="brand"
      className="mention-text hover:border-brand inline-block px-0.5 pb-0.5 hover:border-b"
      style={{
        fontSize: 'inherit',
        fontFamily: 'inherit',
      }}
    >
      {props.children}
    </SizableText>
  )
}
