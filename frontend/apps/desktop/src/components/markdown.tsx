import {useGatewayUrl} from '@/models/gateway-settings'
import {resolveHypermediaRoute, useOpenUrl} from '@/open-url'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useResource} from '@shm/shared/models/entity'
import {hmId, routeToUrl} from '@shm/shared/utils/entity-id-url'
import React from 'react'
import ReactMarkdown, {defaultUrlTransform, type Components, type ExtraProps} from 'react-markdown'
import remarkGfm from 'remark-gfm'

function MarkdownLink({href, children}: React.ComponentProps<'a'> & ExtraProps) {
  const openUrl = useOpenUrl()
  const gatewayUrl = useGatewayUrl().data || DEFAULT_GATEWAY_URL
  const isHypermediaLink = href?.startsWith('hm://') ?? false
  const resolvedLink = React.useMemo(
    () => (href && isHypermediaLink ? resolveHypermediaRoute(href) : null),
    [href, isHypermediaLink],
  )
  const siteHome = useResource(resolvedLink ? hmId(resolvedLink.id.uid) : null)
  const siteUrl = siteHome.data?.type === 'document' ? siteHome.data.document.metadata?.siteUrl : null
  const renderedHref = React.useMemo(() => {
    if (!href || !resolvedLink) return href
    return routeToUrl(resolvedLink.route, {
      hostname: siteUrl || gatewayUrl,
      originHomeId: siteUrl ? hmId(resolvedLink.id.uid) : undefined,
    })
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

/** Renders assistant markdown with in-app handling for Hypermedia links. */
export function Markdown({children}: {children: string}) {
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
      remarkPlugins={[remarkGfm]}
      components={components}
      urlTransform={(value) => (value.startsWith('hm://') ? value : defaultUrlTransform(value))}
    >
      {children}
    </ReactMarkdown>
  )
}
