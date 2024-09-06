import {
  AutocompletePopup,
  createAutoCompletePlugin,
} from '@/editor/autocomplete'
import {useEntity} from '@/models/entities'
import {getDocumentTitle, UnpackedHypermediaId, unpackHmId} from '@shm/shared'
import {SizableText} from '@shm/ui'
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
    renderHTML() {
      return ['span']
    },
    parseHTML() {
      return [
        {
          tag: `span[data-inline-embed]`,
          getAttrs: (dom) => {
            if (dom instanceof HTMLElement) {
              var value = dom.getAttribute('data-inline-embed')
              return {ref: value}
            }
            return false
          },
        },
      ]
    },
    addAttributes() {
      return {
        ref: {
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
      className={`inline-embed-token${props.selected ? ' selected' : ''}`}
      data-inline-embed-ref={props.node.attrs.ref}
    >
      <MentionToken value={props.node.attrs.ref} selected={props.selected} />
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
  const entity = useEntity(unpackedRef)
  return (
    <MentionText selected={selected}>
      @
      {entity.data?.document
        ? getDocumentTitle(entity.data?.document)
        : unpackedRef.id}
    </MentionText>
  )
}

export function MentionText(props) {
  return (
    <SizableText
      fontSize="1em"
      paddingHorizontal={1}
      style={{
        display: 'inline-block',
        fontFamily: 'inherit',
      }}
      color="$brand5"
      outlineColor="$brand5"
    >
      {props.children}
    </SizableText>
  )
}
