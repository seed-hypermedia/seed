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

        const attrs = getAttributes(view.state, options.type.name)
        const link = event.target as HTMLLinkElement

        const href = link?.href ?? attrs.href

        if (link && href) {
          let newWindow = false // todo, check for meta key
          // Disabled behavior where link clicks mean "open", this interrupts the editing experience
          // options.openUrl(href, newWindow)
          return true
        }

        return false
      },
    },
  })
}
