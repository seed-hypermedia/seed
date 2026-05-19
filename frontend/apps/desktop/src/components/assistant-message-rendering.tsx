import {buildLegacyChatMessageParts, type ChatMessagePart, type ChatToolPart} from '@/models/chat-parts'
import {getSeedToolMetadata} from '../../../../../agents/protocol/src/tool-registry'
import {useOpenUrl} from '@/open-url'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {Button} from '@shm/ui/button'
import {cn} from '@shm/ui/utils'
import {
  ArrowUpRight,
  BookOpenText,
  ChevronDown,
  ChevronRight,
  Compass,
  Info,
  Loader2,
  PenLine,
  Search,
  Wrench,
} from 'lucide-react'
import React, {Suspense, useState} from 'react'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@shm/ui/components/dialog'
import {Markdown} from './markdown'

/** Renders a chat message bubble shared by the assistant panel and Agents session UI. */
export const ChatMessageBubble = React.memo(function ChatMessageBubble({message}: {message: ChatBubbleMessage}) {
  const [showRawMarkdown, setShowRawMarkdown] = useState(false)
  const isUser = message.role === 'user'
  const rawMarkdown = message.rawMarkdown ?? message.content

  return (
    <div className="group/message my-1.5">
      {isUser ? (
        <div className="flex items-start gap-1">
          <div className="ml-6 min-w-0 flex-1 rounded-lg border border-sky-200 bg-sky-100 px-3 py-2 text-[13px] text-slate-950 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-50 [&_.ProseMirror]:!text-[13px] [&_.hm-prose]:!text-[13px]">
            {message.blocks?.length ? (
              <div className="text-foreground rounded-md bg-transparent px-1 py-0.5 [&_.ProseMirror]:!bg-transparent [&_.bn-container]:!bg-transparent [&_.bn-editor]:!bg-transparent [&_.hm-prose]:!font-sans [&_.hm-prose]:!text-base">
                <Suspense fallback={<Markdown>{message.content || ''}</Markdown>}>
                  <RichMessageBlocks blocks={message.blocks} />
                </Suspense>
              </div>
            ) : (
              <Markdown>{message.content || ''}</Markdown>
            )}
          </div>
          {rawMarkdown ? <RawMarkdownButton onClick={() => setShowRawMarkdown(true)} /> : null}
        </div>
      ) : (
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <AssistantMessageParts parts={getAssistantMessageParts(message)} />
          </div>
          {rawMarkdown ? <RawMarkdownButton onClick={() => setShowRawMarkdown(true)} /> : null}
        </div>
      )}
      {message.errorMessage ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive mt-1 mr-6 rounded-lg border px-3 py-2 text-xs">
          <div className="mb-1 font-medium">Error</div>
          <p className="whitespace-pre-wrap">{message.errorMessage}</p>
        </div>
      ) : null}
      {rawMarkdown ? (
        <Dialog open={showRawMarkdown} onOpenChange={setShowRawMarkdown}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Message details</DialogTitle>
              <DialogDescription>This is the exact markdown text represented by this message.</DialogDescription>
            </DialogHeader>
            {message.shareUrl ? (
              <div className="flex flex-col gap-2">
                <div className="text-muted-foreground text-xs">Share URL</div>
                <div className="flex gap-2">
                  <code className="bg-muted min-w-0 flex-1 overflow-auto rounded-md p-2 text-xs whitespace-nowrap">
                    {message.shareUrl}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void navigator.clipboard?.writeText(message.shareUrl!)}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 text-xs">
              {message.sessionId ? (
                <span className="bg-muted rounded px-2 py-1">Session: {message.sessionId}</span>
              ) : null}
              {message.eventId ? <span className="bg-muted rounded px-2 py-1">Message: {message.eventId}</span> : null}
              {typeof message.seq === 'number' ? (
                <span className="bg-muted rounded px-2 py-1">Seq: {message.seq}</span>
              ) : null}
            </div>
            <pre className="bg-muted max-h-[50vh] overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
              {rawMarkdown}
            </pre>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
})

/** Renders assistant message parts with the same markdown, tool, and streaming cursor UI used by the desktop assistant. */
export const AssistantMessageParts = React.memo(function AssistantMessageParts({
  parts,
  isStreaming = false,
}: {
  parts: ChatMessagePart[]
  isStreaming?: boolean
}) {
  return parts.map((part, index) => {
    if (part.type === 'tool') {
      return <ToolCallItem key={`${part.id}:${index}`} item={part} />
    }

    const showCursor = isStreaming && index === parts.length - 1
    return (
      <div key={`text:${index}`} className="bg-muted my-1 mr-6 rounded-lg px-3 py-2 text-sm">
        <Markdown enableGfm={!isStreaming}>{part.text}</Markdown>
        {showCursor && <span className="bg-foreground inline-block h-3 w-1 animate-pulse" />}
      </div>
    )
  })
})

/** Message shape accepted by the shared assistant chat bubble renderer. */
export type ChatBubbleMessage = {
  role?: string
  content?: string
  parts?: ChatMessagePart[]
  toolCalls?: Array<{id: string; name: string; args: Record<string, unknown>}>
  toolResults?: Array<{id: string; name: string; result: string; rawOutput?: unknown}>
  errorMessage?: string
  rawMarkdown?: string
  blocks?: HMBlockNode[]
  eventId?: string
  sessionId?: string
  seq?: number
  shareUrl?: string
}

const RichMessageBlocks = React.lazy(async () => {
  const module = await import('@shm/editor/readonly-viewer')
  return {
    default: ({blocks}: {blocks: HMBlockNode[]}) => (
      <module.ReadOnlyViewer
        blocks={blocks}
        commentStyle
        textUnit={13}
        layoutUnit={18}
        className="agent-message-blocks"
      />
    ),
  }
})

function RawMarkdownButton({onClick}: {onClick: () => void}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground mt-1 rounded p-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus:opacity-100"
      aria-label="Show markdown sent to the LLM"
      title="Show markdown sent to the LLM"
    >
      <Info className="size-3.5" />
    </button>
  )
}

function getAssistantMessageParts(message: ChatBubbleMessage) {
  if (message.parts && message.parts.length > 0) {
    return message.parts
  }

  return buildLegacyChatMessageParts({
    content: message.content,
    toolCalls: message.toolCalls,
    toolResults: message.toolResults,
  })
}

type SearchToolResultItem = {
  title: string
  url: string
  type: string
  parentNames: string[]
  versionTime?: string
}

type SearchToolOutput = {
  summary: string
  markdown: string
  query: string
  searchType: string
  includeBody: boolean
  results: SearchToolResultItem[]
}

type ReadToolOutput = {
  summary: string
  resourceUrl: string
  view: string
  markdown?: string
  title?: string
  displayLabel?: string
}

type NavigateToolOutput = {
  summary: string
  resourceUrl: string
  newWindow: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getStringArg(args: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!args) return undefined
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

function getBooleanArg(args: Record<string, unknown> | undefined, key: string): boolean | undefined {
  if (!args) return undefined
  const value = args[key]
  return typeof value === 'boolean' ? value : undefined
}

function getSearchToolOutput(rawOutput: unknown): SearchToolOutput | null {
  if (!isRecord(rawOutput) || typeof rawOutput.markdown !== 'string' || !Array.isArray(rawOutput.results)) {
    return null
  }

  const results = rawOutput.results.flatMap((result) => {
    if (
      !isRecord(result) ||
      typeof result.title !== 'string' ||
      typeof result.url !== 'string' ||
      typeof result.type !== 'string' ||
      !Array.isArray(result.parentNames)
    ) {
      return []
    }

    return [
      {
        title: result.title,
        url: result.url,
        type: result.type,
        parentNames: result.parentNames.filter((parent): parent is string => typeof parent === 'string'),
        versionTime: typeof result.versionTime === 'string' ? result.versionTime : undefined,
      },
    ]
  })

  return {
    summary: typeof rawOutput.summary === 'string' ? rawOutput.summary : '',
    markdown: rawOutput.markdown,
    query: typeof rawOutput.query === 'string' ? rawOutput.query : '',
    searchType: typeof rawOutput.searchType === 'string' ? rawOutput.searchType : 'hybrid',
    includeBody: rawOutput.includeBody === true,
    results,
  }
}

function getReadToolOutput(rawOutput: unknown): ReadToolOutput | null {
  if (!isRecord(rawOutput)) return null

  if (
    typeof rawOutput.resourceUrl === 'string' &&
    typeof rawOutput.view === 'string' &&
    (typeof rawOutput.markdown === 'string' || rawOutput.markdown === undefined)
  ) {
    return {
      summary: typeof rawOutput.summary === 'string' ? rawOutput.summary : '',
      resourceUrl: rawOutput.resourceUrl,
      view: rawOutput.view,
      markdown: typeof rawOutput.markdown === 'string' ? rawOutput.markdown : undefined,
      title: typeof rawOutput.title === 'string' ? rawOutput.title : undefined,
      displayLabel: typeof rawOutput.displayLabel === 'string' ? rawOutput.displayLabel : undefined,
    }
  }

  if (rawOutput.type === 'hypermedia_document' && typeof rawOutput.id === 'string') {
    return {
      summary: typeof rawOutput.title === 'string' ? rawOutput.title : '',
      resourceUrl: rawOutput.id,
      view: typeof rawOutput.format === 'string' ? rawOutput.format : 'document',
      markdown: typeof rawOutput.markdown === 'string' ? rawOutput.markdown : undefined,
      title: typeof rawOutput.title === 'string' ? rawOutput.title : undefined,
      displayLabel: typeof rawOutput.title === 'string' ? rawOutput.title : undefined,
    }
  }

  return null
}

function getNavigateToolOutput(rawOutput: unknown): NavigateToolOutput | null {
  if (!isRecord(rawOutput) || typeof rawOutput.resourceUrl !== 'string' || typeof rawOutput.newWindow !== 'boolean') {
    return null
  }

  return {
    summary: typeof rawOutput.summary === 'string' ? rawOutput.summary : '',
    resourceUrl: rawOutput.resourceUrl,
    newWindow: rawOutput.newWindow,
  }
}

function formatToolDebugValue(value: unknown): string {
  if (value === undefined) return '(none)'
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatCompactValue(value: unknown): string {
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function getToolResourceUrl(item: ChatToolPart): string | undefined {
  if (isRecord(item.rawOutput) && typeof item.rawOutput.resourceUrl === 'string') {
    return item.rawOutput.resourceUrl
  }
  if (isRecord(item.rawOutput) && typeof item.rawOutput.id === 'string') {
    return item.rawOutput.id
  }
  return getStringArg(item.args, 'url') || getStringArg(item.args, 'id')
}

function ToolChip({children}: {children: React.ReactNode}) {
  return (
    <span className="bg-background/75 text-muted-foreground rounded-full border px-1.5 py-0.5 text-[9px] font-medium">
      {children}
    </span>
  )
}

function ToolResourceLink({url, label}: {url: string; label: string}) {
  const openUrl = useOpenUrl()

  return (
    <button
      type="button"
      title={url}
      onClick={(event) => openUrl(url, event.metaKey || event.shiftKey)}
      className="bg-background/75 hover:bg-background inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.75 text-left text-[10px] font-medium transition-colors"
    >
      <span className="truncate">{label}</span>
      <ArrowUpRight className="size-2.5 shrink-0" />
    </button>
  )
}

function ToolCallDebugDialog({
  item,
  open,
  onOpenChange,
}: {
  item: ChatToolPart
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[min(44rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>Raw tool call payload captured during the assistant response.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-3">
          <div className="min-h-0 space-y-1">
            <div className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">Input</div>
            <pre className="bg-muted max-h-48 overflow-auto rounded-xl p-3 text-[11px] whitespace-pre-wrap">
              {formatToolDebugValue(item.args)}
            </pre>
          </div>
          <div className="min-h-0 space-y-1">
            <div className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">Output</div>
            <pre className="bg-muted max-h-72 overflow-auto rounded-xl p-3 text-[11px] whitespace-pre-wrap">
              {formatToolDebugValue(item.rawOutput ?? item.result)}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ToolCallBubble({
  item,
  icon: Icon,
  label,
  bubbleClassName,
  iconClassName,
  hideResultText,
  children,
}: {
  item: ChatToolPart
  icon: React.ComponentType<{className?: string}>
  label: string
  bubbleClassName: string
  iconClassName: string
  hideResultText?: boolean
  children?: React.ReactNode
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const isPending = item.result === undefined && item.rawOutput === undefined

  return (
    <>
      <div
        className={cn(
          'group relative my-1.5 mr-6 overflow-hidden rounded-xl border px-2.5 py-2 text-xs shadow-sm',
          bubbleClassName,
        )}
      >
        <button
          type="button"
          title="View raw tool input/output"
          onClick={() => setDetailsOpen(true)}
          className="bg-background/85 text-muted-foreground hover:text-foreground absolute top-1.5 right-1.5 rounded-full border p-0.75 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Info className="size-3" />
        </button>
        <div className="flex items-start gap-2.5 pr-7">
          <div
            className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border', iconClassName)}
          >
            {isPending ? <Loader2 className="size-3 animate-spin" /> : <Icon className="size-3" />}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium">{label}</span>
              {isPending ? <ToolChip>Running</ToolChip> : null}
            </div>
            {hideResultText ? null : <p className="text-foreground/80">{item.result || 'Running...'}</p>}
            {children}
          </div>
        </div>
      </div>
      <ToolCallDebugDialog item={item} open={detailsOpen} onOpenChange={setDetailsOpen} />
    </>
  )
}

function SearchToolCallBubble({item}: {item: ChatToolPart}) {
  const [expanded, setExpanded] = useState(false)
  const searchOutput = getSearchToolOutput(item.rawOutput)
  const hasExpandableContent = Boolean(searchOutput)

  return (
    <ToolCallBubble
      item={item}
      icon={Search}
      label="Search"
      bubbleClassName="border-sky-500/30 bg-sky-500/10"
      iconClassName="border-sky-500/25 bg-background/80 text-sky-500"
    >
      {searchOutput ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {searchOutput.query ? <ToolChip>&ldquo;{searchOutput.query}&rdquo;</ToolChip> : null}
            <ToolChip>
              {searchOutput.results.length} result{searchOutput.results.length === 1 ? '' : 's'}
            </ToolChip>
            <ToolChip>{searchOutput.searchType}</ToolChip>
            <ToolChip>{searchOutput.includeBody ? 'body included' : 'titles only'}</ToolChip>
          </div>
          {hasExpandableContent ? (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="hover:bg-background/70 inline-flex items-center gap-1 rounded-full border px-2 py-0.75 text-[10px] font-medium transition-colors"
            >
              <span>{expanded ? 'Hide results' : 'Show results'}</span>
              {expanded ? <ChevronDown className="size-2.5" /> : <ChevronRight className="size-2.5" />}
            </button>
          ) : null}
          {expanded ? (
            <div className="bg-background/60 rounded-xl border px-2.5 py-2">
              <Markdown>{searchOutput.markdown}</Markdown>
            </div>
          ) : null}
        </div>
      ) : null}
    </ToolCallBubble>
  )
}

function ReadToolCallBubble({item}: {item: ChatToolPart}) {
  const readOutput = getReadToolOutput(item.rawOutput)
  const resourceUrl = readOutput?.resourceUrl || getToolResourceUrl(item)
  const resourceLabel =
    readOutput?.displayLabel ||
    (readOutput?.view === 'comments' ? (readOutput.title ? `${readOutput.title} Comments` : 'Comments') : undefined) ||
    readOutput?.title ||
    resourceUrl ||
    'Untitled document'

  return (
    <ToolCallBubble
      item={item}
      icon={BookOpenText}
      label="Read"
      bubbleClassName="border-emerald-500/30 bg-emerald-500/10"
      iconClassName="border-emerald-500/25 bg-background/80 text-emerald-500"
      hideResultText
    >
      <div className="flex flex-wrap gap-2">{readOutput?.view ? <ToolChip>{readOutput.view}</ToolChip> : null}</div>
      {resourceUrl ? <ToolResourceLink url={resourceUrl} label={resourceLabel} /> : null}
    </ToolCallBubble>
  )
}

function NavigateToolCallBubble({item}: {item: ChatToolPart}) {
  const navigateOutput = getNavigateToolOutput(item.rawOutput)
  const resourceUrl = navigateOutput?.resourceUrl || getToolResourceUrl(item)
  const opensInNewWindow = navigateOutput?.newWindow ?? getBooleanArg(item.args, 'newWindow')

  return (
    <ToolCallBubble
      item={item}
      icon={Compass}
      label="Navigate"
      bubbleClassName="border-amber-500/30 bg-amber-500/10"
      iconClassName="border-amber-500/25 bg-background/80 text-amber-500"
    >
      <div className="flex flex-wrap gap-2">
        <ToolChip>{opensInNewWindow ? 'new window' : 'current window'}</ToolChip>
      </div>
      {resourceUrl ? <ToolResourceLink url={resourceUrl} label="Open target" /> : null}
    </ToolCallBubble>
  )
}

function WriteToolCallBubble({item}: {item: ChatToolPart}) {
  const command = getStringArg(item.args, 'command')

  return (
    <ToolCallBubble
      item={item}
      icon={PenLine}
      label={getSeedToolMetadata(item.name)?.render.label || 'Write'}
      bubbleClassName="border-indigo-500/30 bg-indigo-500/10"
      iconClassName="border-indigo-500/25 bg-background/80 text-indigo-500"
    >
      <div className="flex flex-wrap gap-1.5">
        {command ? <ToolChip>{command}</ToolChip> : null}
        {isRecord(item.rawOutput) && typeof item.rawOutput.url === 'string' ? (
          <ToolResourceLink url={item.rawOutput.url} label="Open result" />
        ) : null}
      </div>
    </ToolCallBubble>
  )
}

function GenericToolCallBubble({item}: {item: ChatToolPart}) {
  const hasArgs = Boolean(item.args && Object.keys(item.args).length > 0)

  return (
    <ToolCallBubble
      item={item}
      icon={Wrench}
      label={item.name}
      bubbleClassName="border-border bg-muted/60"
      iconClassName="border-border bg-background/80 text-muted-foreground"
    >
      {hasArgs ? (
        <div className="bg-background/70 text-muted-foreground rounded-xl border px-2 py-1.5 text-[10px]">
          {Object.entries(item.args!).map(([key, value], index) => (
            <div key={key} className={cn('break-all', index > 0 && 'mt-1')}>
              <span className="font-medium">{key}:</span> {formatCompactValue(value)}
            </div>
          ))}
        </div>
      ) : null}
    </ToolCallBubble>
  )
}

function ToolCallItem({item}: {item: ChatToolPart}) {
  switch (getSeedToolMetadata(item.name)?.render.kind) {
    case 'search':
      return <SearchToolCallBubble item={item} />
    case 'read':
      return <ReadToolCallBubble item={item} />
    case 'navigate':
      return <NavigateToolCallBubble item={item} />
    case 'write':
      return <WriteToolCallBubble item={item} />
    default:
      return <GenericToolCallBubble item={item} />
  }
}
