import {getAttributes} from '@tiptap/core'
import {MarkType} from '@tiptap/pm/model'
import {Plugin, PluginKey} from '@tiptap/pm/state'

type ClickHandlerOptions = {
  type: MarkType
  openUrl?: any
}

export function clickHandler(options: ClickHandlerOptions): Plugin {
  return new Plugin({
    key: new PluginKey('handleClickLink'),
    props: {
      handleClick: (view, pos, event) => {
        if (event.button !== 0) {
          return false
        }

        // In read-only mode, let the browser handle link clicks natively (navigate).
        if (!view.editable) {
          return false
        }

        const attrs = getAttributes(view.state, options.type.name)
        const link = event.target as HTMLLinkElement

        const href = link?.href ?? attrs.href

        if (link && href) {
          // In editable mode, swallow the click to avoid navigating away while editing.
          return true
        }

        return false
      },
    },
  })
}
