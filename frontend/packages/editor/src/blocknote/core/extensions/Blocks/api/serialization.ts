import {Extension} from '@tiptap/core'
import {DOMSerializer, Fragment, Schema} from 'prosemirror-model'
import {Plugin} from 'prosemirror-state'

/**
 * Convert <div> children of <ul>/<ol> into <li> elements.
 */
function rewriteListChildren(root: HTMLElement | DocumentFragment, doc: Document) {
  for (const list of Array.from(root.querySelectorAll('ul, ol'))) {
    for (const child of Array.from(list.children)) {
      if (child.tagName === 'DIV' && child.getAttribute('data-node-type') === 'blockNode') {
        const li = doc.createElement('li')
        for (const attr of Array.from(child.attributes)) {
          li.setAttribute(attr.name, attr.value)
        }
        while (child.firstChild) {
          li.appendChild(child.firstChild)
        }
        child.replaceWith(li)
      }
    }
  }
}

const customBlockSerializer = (schema: Schema) => {
  const defaultSerializer = DOMSerializer.fromSchema(schema)

  const serializer = new DOMSerializer(
    {
      ...defaultSerializer.nodes,
      // TODO: If a serializer is defined in the config for a custom block, it
      //  should be added here. We still need to figure out how the serializer
      //  should be defined in the custom blocks API though, and implement that,
      //  before we can do this.
    },
    defaultSerializer.marks,
  )

  const originalSerializeFragment = serializer.serializeFragment.bind(serializer)
  serializer.serializeFragment = (
    fragment: Fragment,
    options?: {document?: Document},
    target?: HTMLElement | DocumentFragment,
  ) => {
    const result = originalSerializeFragment(fragment, options, target)
    rewriteListChildren(result, options?.document ?? document)
    return result
  }

  return serializer
}

export const CustomBlockSerializerExtension = Extension.create({
  name: 'CustomBlockSerializer',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          clipboardSerializer: customBlockSerializer(this.editor.schema),
        },
      }),
    ]
  },
})
