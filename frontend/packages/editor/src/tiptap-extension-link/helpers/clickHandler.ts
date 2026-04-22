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
        const embedEl = targetEl?.closest?.('[data-inline-embed]') as HTMLElement | null
        const attrs = getAttributes(view.state, options.type.name)
        const href = linkEl?.getAttribute('href') ?? attrs.href ?? embedEl?.getAttribute('data-inline-embed') ?? null

        if (!href) {
          return false
        }

        // In edit mode, plain click must place the cursor so the hyperlink
        // toolbar can open. Only navigate when the editor is read-only, or
        // when the user explicitly holds a modifier.
        const modifierPressed = event.shiftKey || event.metaKey || event.ctrlKey
        if (view.editable && !modifierPressed) {
          return false
        }

        const newWindow = modifierPressed
        if (options.openUrl) {
          options.openUrl(href, newWindow)
        } else if (typeof window !== 'undefined') {
          if (newWindow) {
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
