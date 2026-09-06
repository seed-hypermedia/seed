import {resolveHypermediaRoute, useOpenUrl} from './navigation'
import {getAgentsPlatform} from './platform'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useResource} from '@shm/shared/models/entity'
import {hmId, routeToUrl} from '@shm/shared/utils/entity-id-url'
import {ImageOff, Loader2} from 'lucide-react'
import React from 'react'
import {useAgentMemoryFile, useSessionAttachmentDataUrls} from './models'
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

/**
 * Where a transcript's inline assets resolve from: the agent whose private memory holds them and
 * the session whose attachments they came from. Provided per message bubble; absent outside a
 * transcript, where memory and attachment images render as labeled placeholders instead.
 */
export type MarkdownAssetScope = {
  serverUrl?: string
  accountUid?: string | null
  agentId?: string
  sessionId?: string
}

export const MarkdownAssetContext = React.createContext<MarkdownAssetScope | null>(null)

export type MarkdownImageSource =
  | {kind: 'url'; url: string}
  /** An IPFS CID, served through the HM gateway. */
  | {kind: 'ipfs'; cid: string; url: string}
  /** A file in the agent's private memory, fetched over the signed agents API. */
  | {kind: 'memory'; path: string}
  /** A session-private attachment the user dropped into the chat. */
  | {kind: 'attachment'; id: string}

/**
 * Classifies an image reference the way the agent addresses things: `ipfs://<cid>` (the
 * `write ipfs://` result), `~/memory/<path>` or the sandbox mount `/workspace/<path>` (memory
 * files), and `attachment:<id>` (chat attachments). Anything else is a plain URL.
 */
export function resolveMarkdownImageSource(src: string, gatewayUrl: string): MarkdownImageSource {
  const ipfs = src.match(/^ipfs:\/\/([^/?#]+)(\/[^?#]*)?/)
  if (ipfs) {
    const cid = ipfs[1]!
    return {kind: 'ipfs', cid, url: `${gatewayUrl.replace(/\/$/, '')}/ipfs/${cid}${ipfs[2] ?? ''}`}
  }
  const memory = src.match(/^(?:~\/memory|\/workspace)\/(.+)$/)
  if (memory) return {kind: 'memory', path: memory[1]!.replace(/^\/+/, '')}
  const attachment = src.match(/^attachment:(?:\/\/)?(.+)$/)
  if (attachment) return {kind: 'attachment', id: attachment[1]!}
  return {kind: 'url', url: src}
}

/** URL schemes react-markdown's sanitizer would drop but the transcript knows how to render. */
const TRANSCRIPT_URL_PREFIXES = ['hm://', 'ipfs://', 'attachment:']

function transcriptUrlTransform(value: string): string {
  return TRANSCRIPT_URL_PREFIXES.some((prefix) => value.startsWith(prefix)) ? value : defaultUrlTransform(value)
}

function ImagePlaceholder({label, detail}: {label: string; detail?: string}) {
  return (
    <span
      className="bg-background/50 text-muted-foreground border-border my-1 inline-flex max-w-full items-center gap-1.5 rounded border px-2 py-1 text-xs"
      title={detail}
    >
      <ImageOff className="size-3.5 flex-none" />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  )
}

/** Renders a resolved image URL, degrading to a labeled placeholder if it fails to load. */
function InlineImage({src, alt, detail}: {src: string; alt?: string; detail: string}) {
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => setFailed(false), [src])
  if (failed) return <ImagePlaceholder label={alt || detail} detail={`Could not load ${detail}`} />
  return (
    <img
      src={src}
      alt={alt ?? ''}
      title={alt || undefined}
      loading="lazy"
      className="my-2 max-h-[480px] max-w-full rounded-md object-contain"
      onError={() => setFailed(true)}
    />
  )
}

/** Turns fetched bytes into an object URL for the lifetime of the element. */
function useObjectUrl(data: Uint8Array | undefined, mimeType: string | undefined): string | null {
  const objectUrl = React.useMemo(() => {
    if (!data || !data.byteLength) return null
    return URL.createObjectURL(new Blob([new Uint8Array(data)], mimeType ? {type: mimeType} : undefined))
  }, [data, mimeType])
  React.useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [objectUrl])
  return objectUrl
}

function MemoryImage({path, alt, scope}: {path: string; alt?: string; scope: MarkdownAssetScope}) {
  const file = useAgentMemoryFile(scope.serverUrl, scope.accountUid, scope.agentId, path)
  const objectUrl = useObjectUrl(file.data?.data, file.data?.mimeType)
  const label = alt || path
  if (file.isLoading) {
    return (
      <span className="text-muted-foreground my-1 inline-flex items-center gap-1.5 text-xs">
        <Loader2 className="size-3.5 animate-spin" />
        {label}
      </span>
    )
  }
  if (file.error) {
    return <ImagePlaceholder label={label} detail={`~/memory/${path}: ${(file.error as Error).message}`} />
  }
  if (!objectUrl || !file.data?.mimeType?.startsWith('image/')) {
    return <ImagePlaceholder label={label} detail={`~/memory/${path} is not an image`} />
  }
  return <InlineImage src={objectUrl} alt={alt} detail={`~/memory/${path}`} />
}

function AttachmentImage({id, alt, scope}: {id: string; alt?: string; scope: MarkdownAssetScope}) {
  const ids = React.useMemo(() => [id], [id])
  const srcById = useSessionAttachmentDataUrls(scope.serverUrl, scope.accountUid, scope.sessionId, ids)
  const src = srcById[id]
  if (!src) return <ImagePlaceholder label={alt || `attachment:${id}`} detail={`attachment:${id}`} />
  return <InlineImage src={src} alt={alt} detail={`attachment:${id}`} />
}

/**
 * Images in agent messages. The agent points at its own artifacts by memory path, attachment id,
 * or `ipfs://` CID — none of which a browser can fetch directly — so each is resolved here:
 * memory and attachment bytes come over the signed agents API (only the owner can see them),
 * and CIDs go through the HM gateway, which serves a blob once public Hypermedia content
 * references it.
 */
function MarkdownImage({src, alt}: React.ComponentProps<'img'> & ExtraProps) {
  const gatewayUrl = useGatewayUrlHook() || DEFAULT_GATEWAY_URL
  const scope = React.useContext(MarkdownAssetContext)
  const source = React.useMemo(() => (src ? resolveMarkdownImageSource(src, gatewayUrl) : null), [src, gatewayUrl])
  if (!source) return null
  if (source.kind === 'memory') {
    if (!scope?.agentId) return <ImagePlaceholder label={alt || source.path} detail={`~/memory/${source.path}`} />
    return <MemoryImage path={source.path} alt={alt} scope={scope} />
  }
  if (source.kind === 'attachment') {
    if (!scope?.sessionId) return <ImagePlaceholder label={alt || `attachment:${source.id}`} />
    return <AttachmentImage id={source.id} alt={alt} scope={scope} />
  }
  return <InlineImage src={source.url} alt={alt} detail={src!} />
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
    if (href?.startsWith('ipfs://')) {
      const source = resolveMarkdownImageSource(href, gatewayUrl)
      return source.kind === 'ipfs' ? source.url : href
    }
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
    img: MarkdownImage,
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
      urlTransform={transcriptUrlTransform}
    >
      {children}
    </ReactMarkdown>
  )
}
