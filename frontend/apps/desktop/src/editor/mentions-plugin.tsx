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
        title: {
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
      data-inline-embed={props.node.attrs.link}
      data-title={props.node.attrs.title}
    >
      <MentionToken
        value={props.node.attrs.link}
        title={props.node.attrs.title}
        selected={props.selected}
        updateAttributes={props.updateAttributes}
      />
    </NodeViewWrapper>
  )
}

export function MentionToken(props: {
  value: string
  title: string
  selected?: boolean
  updateAttributes: (attributes: {[key: string]: any}) => void
}) {
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
  title,
  selected,
  updateAttributes,
}: {
  unpackedRef: UnpackedHypermediaId
  title: string
  selected?: boolean
  updateAttributes: (attributes: {[key: string]: any}) => void
}) {
  let mentionTitle = title
  if (!mentionTitle) {
    const entity = useEntity(unpackedRef)
    const docTitle = entity.data?.document
      ? getDocumentTitle(entity.data?.document)
      : unpackedRef.id

    if (!mentionTitle && docTitle) {
      updateAttributes({title: docTitle})
    }
  }

  return <MentionText selected={selected}>{mentionTitle}</MentionText>
}

export function MentionText(props: any) {
  return (
    <SizableText
      fontSize="1em"
      fontWeight="bold"
      paddingBottom={1}
      paddingHorizontal={1}
      style={{
        display: 'inline-block',
        fontFamily: 'inherit',
      }}
      color="$brand5"
      outlineColor="$brand5"
      className="mention-text"
      hoverStyle={{
        borderBottomWidth: 1,
        borderBottomColor: '$brand5',
      }}
    >
      {props.children}
    </SizableText>
  )
}
