import {Mark, mergeAttributes} from '@tiptap/core'
import {Plugin} from '@tiptap/pm/state'
import {registerCustomProtocol, reset} from 'linkifyjs'
import type {UniversalClient} from '@shm/shared/universal-client'

import {autolink} from './helpers/autolink'
import {clickHandler} from './helpers/clickHandler'
import {pasteHandler} from './helpers/pasteHandler'

export interface LinkProtocolOptions {
  scheme: string
  optionalSlashes?: boolean
}

export interface LinkOptions {
  /**
   * If enabled, it adds links as you type.
   */
  autolink: boolean
  /**
   * An array of custom protocols to be registered with linkifyjs.
   */
  protocols: Array<LinkProtocolOptions | string>
  /**
   * If enabled, links will be opened on click.
   */
  openOnClick: boolean
  /**
   * Adds a link to the current selection if the pasted content only contains an url.
   */
  linkOnPaste: boolean
  /**
   * A list of HTML attributes to be rendered.
   */
  HTMLAttributes: Record<string, any>
  /**
   * A validation function that modifies link verification for the auto linker.
   * @param url - The url to be validated.
   * @returns - True if the url is valid, false otherwise.
   */
  validate?: (url: string) => boolean
  checkWebUrl: (url: string) => Promise<any>
  universalClient?: UniversalClient
  /**
   * Converts the stored link URL into the href rendered into the DOM.
   */
  renderHref?: (url: string) => string
  /**
   * If enabled, modified clicks are handled by the platform openUrl handler.
   */
  handleModifiedClicks?: boolean
}

/** Returns the canonical raw href stored on a rendered link element. */
export function getLinkAttrsFromElement(element: HTMLElement): false | Record<string, string> {
  if (element.hasAttribute('data-inline-embed')) return false

  const href = element.getAttribute('data-hm-link') || element.getAttribute('href')
  if (!href) return false

  const attrs: Record<string, string> = {
    href,
  }

  const target = element.getAttribute('target')
  if (target) attrs.target = target

  const className = element.getAttribute('class')
  if (className) attrs.class = className

  const id = element.getAttribute('id')
  if (id) attrs.id = id

  return attrs
}

/** Builds DOM attributes for a rendered link while preserving the canonical raw href. */
export function buildRenderedLinkAttributes(
  htmlAttributes: Record<string, any>,
  renderHref?: (url: string) => string,
): Record<string, any> {
  const attrs = {...htmlAttributes}
  const rawHref = typeof attrs.href === 'string' ? attrs.href : null
  const renderedHref = rawHref ? renderHref?.(rawHref) ?? rawHref : attrs.href

  return {
    ...attrs,
    ...(rawHref ? {'data-hm-link': rawHref} : {}),
    href: renderedHref,
    class: `${attrs.class} text-link hover:text-link-hover`,
  }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    link: {
      /**
       * Set a link mark
       */
      setLink: (attributes: {href: string; target?: string | null}) => ReturnType
      /**
       * Toggle a link mark
       */
      toggleLink: (attributes: {href: string; target?: string | null}) => ReturnType
      /**
       * Unset a link mark
       */
      unsetLink: () => ReturnType
    }
  }
}

export const Link = Mark.create<LinkOptions>({
  name: 'link',

  priority: 1000,

  keepOnSplit: false,

  onCreate() {
    this.options.protocols.forEach((protocol) => {
      if (typeof protocol === 'string') {
        registerCustomProtocol(protocol)
        return
      }
      registerCustomProtocol(protocol.scheme, protocol.optionalSlashes)
    })
  },

  onDestroy() {
    reset()
  },

  // inclusive() {
  //   return this.options.autolink
  // },

  inclusive: false,

  addOptions() {
    return {
      openOnClick: true,
      linkOnPaste: true,
      autolink: true,
      protocols: [],
      HTMLAttributes: {
        rel: 'noopener noreferrer nofollow',
        class: 'link text-link hover:text-link-hover',
      },
      validate: undefined,
      checkWebUrl: () => Promise.resolve(),
      renderHref: (url: string) => url,
      handleModifiedClicks: false,
    }
  },

  addAttributes() {
    return {
      href: {
        default: null,
      },
      target: {
        default: null,
      },
      class: {
        default: this.options.HTMLAttributes.class,
      },
      id: {
        default: null,
      },
    }
  },

  parseHTML() {
    const getAttrs = (dom: string | HTMLElement) => {
      if (!(dom instanceof HTMLElement)) return false
      return getLinkAttrsFromElement(dom)
    }

    return [
      {tag: 'a[data-hm-link]:not([data-inline-embed]):not([href *= "javascript:" i])', getAttrs},
      {tag: 'a[href]:not([data-inline-embed]):not([href *= "javascript:" i])', getAttrs},
      {tag: 'span.link:not([data-inline-embed])', getAttrs},
    ]
  },

  renderHTML({HTMLAttributes}) {
    const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)
    const tag = this.options.openOnClick ? 'a' : 'span'
    return [tag, buildRenderedLinkAttributes(attrs, this.options.renderHref), 0]
  },

  addCommands() {
    return {
      setLink:
        (attributes) =>
        ({chain}) => {
          return chain().setMark(this.name, attributes).setMeta('preventAutolink', true).run()
        },

      toggleLink:
        (attributes) =>
        ({chain}) => {
          return chain()
            .toggleMark(this.name, attributes, {extendEmptyMarkRange: true})
            .setMeta('preventAutolink', true)
            .run()
        },

      unsetLink:
        () =>
        ({chain}) => {
          return chain().unsetMark(this.name, {extendEmptyMarkRange: true}).setMeta('preventAutolink', true).run()
        },
    }
  },

  addProseMirrorPlugins() {
    const plugins: Plugin[] = []

    if (this.options.autolink) {
      plugins.push(
        autolink({
          type: this.type,
          validate: this.options.validate,
        }),
      )
    }

    if (this.options.openOnClick) {
      plugins.push(
        clickHandler({
          openUrl: (this.options as any).openUrl,
          handleModifiedClicks: this.options.handleModifiedClicks,
          type: this.type,
        }),
      )
    }
    plugins.push(
      pasteHandler({
        universalClient: this.options.universalClient,
        domainResolver: (this.options as any).domainResolver,
        gwUrl: (this.options as any).gwUrl,
        editor: this.editor,
        type: this.type,
        linkOnPaste: this.options.linkOnPaste,
        checkWebUrl: this.options.checkWebUrl,
      }),
    )

    return plugins
  },
})
