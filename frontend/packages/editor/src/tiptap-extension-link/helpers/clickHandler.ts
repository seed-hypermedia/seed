import {getAttributes} from '@tiptap/core'
import {MarkType} from '@tiptap/pm/model'
import {Plugin, PluginKey} from '@tiptap/pm/state'

type OpenUrlFn = (url?: string, newWindow?: boolean) => void

type ClickHandlerOptions = {
  type: MarkType
  openUrl?: OpenUrlFn
  handleModifiedClicks?: boolean
}

export function clickHandler(options: ClickHandlerOptions): Plugin {
  return new Plugin({
    key: new PluginKey('handleClickLink'),
    props: {
      handleDOMEvents: {
        click: (view, event) => {
          if (event.button !== 0) {
            return false
          }

          const targetEl = event.target as HTMLElement | null
          const anchorEl = targetEl?.closest?.('a[href]') as HTMLElement | null
          const linkEl = targetEl?.closest?.('.link') as HTMLElement | null
          const embedEl = targetEl?.closest?.('[data-inline-embed]') as HTMLElement | null
          const attrs = getAttributes(view.state, options.type.name)
          const href =
            anchorEl?.getAttribute('href') ??
            linkEl?.getAttribute('href') ??
            attrs.href ??
            embedEl?.getAttribute('data-inline-embed') ??
            null

          if (!href) {
            return false
          }

          // Shift-click extends the current text selection. If the endpoint is
          // a link, suppress anchor navigation without claiming the event so
          // ProseMirror can keep handling the selection gesture.
          if (event.shiftKey) {
            event.preventDefault()
            return false
          }

          // In edit mode, plain click must place the cursor so the hyperlink
          // toolbar can open. Only navigate when the editor is read-only, or
          // when the user explicitly holds Cmd/Ctrl.
          const openInNewWindow = event.metaKey || event.ctrlKey
          if (view.editable && !openInNewWindow) {
            event.preventDefault()
            return false
          }

          if (openInNewWindow && !options.handleModifiedClicks) {
            return false
          }

          event.preventDefault()
          event.stopPropagation()
          if (options.openUrl) {
            options.openUrl(href, openInNewWindow)
          } else if (typeof window !== 'undefined') {
            if (openInNewWindow) {
              window.open(href, '_blank', 'noopener,noreferrer')
            } else {
              window.location.href = href
            }
          }

          return true
        },
      },
    },
  })
}
