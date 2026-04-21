import {getAttributes} from '@tiptap/core'
import {MarkType} from '@tiptap/pm/model'
import {Plugin, PluginKey} from '@tiptap/pm/state'

type OpenUrlFn = (url?: string, newWindow?: boolean) => void

type ClickHandlerOptions = {
  type: MarkType
  openUrl?: OpenUrlFn
}

export function clickHandler(options: ClickHandlerOptions): Plugin {
  return new Plugin({
    key: new PluginKey('handleClickLink'),
    props: {
      handleClick: (view, pos, event) => {
        if (event.button !== 0) {
          return false
        }

        const targetEl = event.target as HTMLElement | null
        const linkEl = targetEl?.closest?.('.link, a[href]') as HTMLElement | null
        const attrs = getAttributes(view.state, options.type.name)
        const href = linkEl?.getAttribute('href') ?? attrs.href

        if (!href) {
          return false
        }

        if (options.openUrl) {
          const newWindow = event.metaKey || event.ctrlKey
          options.openUrl(href, newWindow)
        } else if (typeof window !== 'undefined') {
          if (event.metaKey || event.ctrlKey) {
            window.open(href, '_blank', 'noopener,noreferrer')
          } else {
            window.location.href = href
          }
        }

        return true
      },
    },
  })
}
