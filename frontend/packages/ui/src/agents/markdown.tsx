import {resolveHypermediaRoute, useOpenUrl} from './navigation'
import {getAgentsPlatform} from './platform'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useResource} from '@shm/shared/models/entity'
import {hmId, routeToUrl} from '@shm/shared/utils/entity-id-url'
import React from 'react'
import ReactMarkdown, {defaultUrlTransform, type Components, type ExtraProps} from 'react-markdown'
// The bare `remark-gfm` specifier is ambiguous in the renderer bundle: the
// vite alias pulls @shm/editor in by source, so the dep optimizer resolves
// `remark-gfm` against the editor's node_modules (v3, mdast-util v1 era) and
// serves that single prebundle to every importer. react-markdown@10 needs the
// v4 mdast context — feeding it v3 throws `this.getData is not a function`
// on inline code inside tables. The npm-aliased name pins v4 unambiguously.
import remarkGfm from 'remark-gfm-v4'

type MdastNode = {type?: string; value?: string; children?: MdastNode[]}

/**
 * Removes HTML comment nodes so HM identity markers (`<!-- id:… -->`,
 * `<!-- col:… -->`) and any other comments never render as literal text in
 * chat. Operates on the mdast tree, so comments inside code blocks and code
 * spans are untouched — their content lives in code nodes, not html nodes.
 */
function remarkStripHtmlComments() {
  const strip = (node: MdastNode) => {
    if (!node.children) return
    node.children = node.children.filter(
      (child) =>
        !(child.type === 'html' && typeof child.value === 'string' && child.value.trimStart().startsWith('<!--')),
    )
    node.children.forEach(strip)
  }
  return (tree: MdastNode) => strip(tree)
}

// The platform is registered once before render and never swapped, so resolving the optional
// gateway hook through a wrapper keeps hook order stable across renders.
const useGatewayUrlHook: () => string | undefined = () => {
  return (getAgentsPlatform().useGatewayUrl ?? (() => undefined))()
}

function MarkdownLink({href, children}: React.ComponentProps<'a'> & ExtraProps) {
  const openUrl = useOpenUrl()
  const gatewayUrl = useGatewayUrlHook() || DEFAULT_GATEWAY_URL
  const isHypermediaLink = href?.startsWith('hm://') ?? false
  const resolvedLink = React.useMemo(
    () => (href && isHypermediaLink ? resolveHypermediaRoute(href) : null),
    [href, isHypermediaLink],
  )
  const siteHome = useResource(resolvedLink ? hmId(resolvedLink.id.uid) : null)
  const siteUrl = siteHome.data?.type === 'document' ? siteHome.data.document.metadata?.siteUrl : null
  const renderedHref = React.useMemo(() => {
    if (!href || !resolvedLink) return href
    return (
      routeToUrl(resolvedLink.route, {
        hostname: siteUrl || gatewayUrl,
        originHomeId: siteUrl ? hmId(resolvedLink.id.uid) : undefined,
      }) || href
    )
  }, [gatewayUrl, href, resolvedLink, siteUrl])

  return (
    <a
      href={renderedHref}
      className="text-blue-400 underline hover:text-blue-300"
      target={isHypermediaLink ? undefined : '_blank'}
      rel={isHypermediaLink ? undefined : 'noopener noreferrer'}
      onClick={(event) => {
        if (!href || !isHypermediaLink) return
        event.preventDefault()
        openUrl(href, event.metaKey || event.shiftKey)
      }}
    >
      {children}
    </a>
  )
}

/** Renders assistant markdown with in-app handling for Hypermedia links.
 *
 * GFM (tables, strikethrough, autolinks) is on by default; callers pass
 * `enableGfm={false}` while streaming so half-written tables don't flicker
 * between table and paragraph rendering mid-stream. */
export function Markdown({children, enableGfm = true}: {children: string; enableGfm?: boolean}) {
  const components: Components = {
    h1: ({children}) => <h1 className="mt-3 mb-2 text-base font-bold first:mt-0">{children}</h1>,
    h2: ({children}) => <h2 className="mt-3 mb-2 text-sm font-bold first:mt-0">{children}</h2>,
    h3: ({children}) => <h3 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h3>,
    p: ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
    ul: ({children}) => <ul className="mb-2 list-disc pl-4 last:mb-0">{children}</ul>,
    ol: ({children}) => <ol className="mb-2 list-decimal pl-4 last:mb-0">{children}</ol>,
    li: ({children}) => <li className="mb-0.5">{children}</li>,
    a: MarkdownLink,
    blockquote: ({children}) => (
      <blockquote className="border-muted-foreground/30 my-2 border-l-2 pl-3 italic">{children}</blockquote>
    ),
    strong: ({children}) => <strong className="font-semibold">{children}</strong>,
    em: ({children}) => <em>{children}</em>,
    hr: () => <hr className="border-border my-3" />,
    pre: ({children}) => <pre className="bg-background/50 my-2 overflow-x-auto rounded p-2 text-xs">{children}</pre>,
    code: ({className, children}) => {
      const isBlock = !!className
      if (isBlock) {
        return <code className="text-xs">{children}</code>
      }
      return <code className="bg-background/50 rounded px-1 py-0.5 text-xs">{children}</code>
    },
    table: ({children}) => (
      <div className="my-2 overflow-x-auto">
        <table className="border-border min-w-full border-collapse text-xs">{children}</table>
      </div>
    ),
    thead: ({children}) => <thead className="bg-background/30">{children}</thead>,
    th: ({children}) => <th className="border-border border px-2 py-1 text-left font-semibold">{children}</th>,
    td: ({children}) => <td className="border-border border px-2 py-1">{children}</td>,
  }

  return (
    <ReactMarkdown
      remarkPlugins={enableGfm ? [remarkGfm, remarkStripHtmlComments] : [remarkStripHtmlComments]}
      components={components}
      urlTransform={(value) => (value.startsWith('hm://') ? value : defaultUrlTransform(value))}
    >
      {children}
    </ReactMarkdown>
  )
}
