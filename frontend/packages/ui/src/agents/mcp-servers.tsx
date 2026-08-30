/**
 * The Tools tab's MCP section: the account's connected MCP servers, each toggled per agent, with
 * the tools it advertises one click away. A server's tools reach the agent as `<server>__<tool>`
 * documents in its `~/tools/`, so what this section shows is exactly what the agent can `call`.
 */
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@shm/ui/components/alert-dialog'
import {Button} from '@shm/ui/button'
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {ChevronRight, Plus, RefreshCw, Trash2} from 'lucide-react'
import React, {useState} from 'react'
import type {McpServerInfo, McpServerTransport, McpToolInfo} from './client'
import {useDeleteMcpServer, useMcpServers, useRefreshMcpServer, useSaveMcpServer} from './models'

const CHIP_CLASS = 'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase'
const HOVER_ACTIONS_CLASS =
  'flex shrink-0 items-center gap-0.5 opacity-0 group-hover/server:opacity-100 max-sm:opacity-100'

/** `https://mcp.github.com/mcp` → `mcp.github.com`. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * A slug worth suggesting for a server named only by its URL: `mcp.github.com` → `github`,
 * `api.linear.app/mcp` → `linear`, `localhost:3333` → `localhost`.
 */
export function suggestMcpServerName(url: string): string {
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return ''
  }
  const labels = hostname.split('.').filter(Boolean)
  while (labels.length > 1 && ['mcp', 'www', 'api', 'app'].includes(labels[0]!)) labels.shift()
  const label = labels.length > 2 ? labels[labels.length - 2]! : labels[0] || ''
  return label
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

/** The first sentence of a tool's description, for a one-line row. */
function toolSummary(tool: McpToolInfo): string | undefined {
  const description = tool.description?.trim()
  if (!description) return undefined
  const first = description.split(/(?<=\.)\s/, 1)[0] ?? description
  return first.length > 120 ? `${first.slice(0, 117)}…` : first
}

export function AgentMcpServersSection({
  serverUrl,
  accountUid,
  enabledServers,
  onToggleServer,
  readOnly,
  saving,
}: {
  serverUrl: string | undefined
  accountUid: string | null
  /** Names of the servers this agent enables (`definition.mcpServers`). */
  enabledServers: string[]
  onToggleServer: (name: string, enabled: boolean) => void
  readOnly: boolean
  saving: boolean
}) {
  const servers = useMcpServers(serverUrl, accountUid)
  const refreshServer = useRefreshMcpServer(serverUrl, accountUid)
  const addDialog = useAppDialog(AddMcpServerDialog)
  const removeDialog = useAppDialog(RemoveMcpServerDialog, {isAlert: true})
  const toolDialog = useAppDialog(McpToolInfoDialog)
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const list = servers.data ?? []

  async function handleRefresh(name: string) {
    setRefreshing(name)
    try {
      const server = await refreshServer.mutateAsync(name)
      if (server.status.state === 'ok') toast.success(`${name}: ${pluralTools(server.tools.length)}`)
      else toast.error(`${name} could not be reached: ${server.status.error ?? 'unknown error'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not refresh the server')
    } finally {
      setRefreshing(null)
    }
  }

  return (
    <>
      <div className="pt-2">
        <SizableText weight="bold">MCP servers</SizableText>
      </div>
      <div className="grid gap-2">
        {list.map((server) => (
          <McpServerRow
            key={server.id}
            server={server}
            enabled={enabledServers.includes(server.name)}
            readOnly={readOnly}
            saving={saving}
            refreshing={refreshing === server.name}
            onToggle={(enabled) => onToggleServer(server.name, enabled)}
            onRefresh={() => void handleRefresh(server.name)}
            onRemove={() => removeDialog.open({serverUrl, accountUid, server})}
            onInspectTool={(tool) => toolDialog.open({server, tool})}
          />
        ))}
        <div className="flex items-center justify-between gap-3 px-1">
          {servers.isLoading && list.length === 0 ? (
            <SizableText size="sm" color="muted">
              Loading MCP servers…
            </SizableText>
          ) : list.length === 0 ? (
            <SizableText size="sm" color="muted">
              No MCP servers connected — add one to give this agent its tools.
            </SizableText>
          ) : (
            <span />
          )}
          {!readOnly ? (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() =>
                addDialog.open({
                  serverUrl,
                  accountUid,
                  onSaved: (server) => onToggleServer(server.name, true),
                })
              }
            >
              <Plus className="size-4" />
              Add server
            </Button>
          ) : null}
        </div>
      </div>
      {addDialog.content}
      {removeDialog.content}
      {toolDialog.content}
    </>
  )
}

function pluralTools(count: number): string {
  return `${count} tool${count === 1 ? '' : 's'}`
}

function McpServerRow({
  server,
  enabled,
  readOnly,
  saving,
  refreshing,
  onToggle,
  onRefresh,
  onRemove,
  onInspectTool,
}: {
  server: McpServerInfo
  enabled: boolean
  readOnly: boolean
  saving: boolean
  refreshing: boolean
  onToggle: (enabled: boolean) => void
  onRefresh: () => void
  onRemove: () => void
  onInspectTool: (tool: McpToolInfo) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const unreachable = server.status.state === 'error'
  const tools = server.tools
  return (
    <div
      className={`group/server border-border bg-card flex min-w-0 flex-col rounded-xl border px-4 py-3 ${
        enabled ? '' : 'opacity-60'
      }`}
    >
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          className="size-4 shrink-0"
          checked={enabled}
          disabled={readOnly || saving}
          aria-label={`Enable ${server.name} for this agent`}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <SizableText size="sm" weight="bold" className="shrink-0 truncate">
            {server.name}
          </SizableText>
          {unreachable ? (
            <span className={`${CHIP_CLASS} bg-amber-500/10 text-amber-600 dark:text-amber-400`}>Unreachable</span>
          ) : server.status.state === 'ok' ? (
            <span className={`${CHIP_CLASS} bg-muted text-muted-foreground`}>{pluralTools(tools.length)}</span>
          ) : null}
          {server.hasSecrets ? <span className={`${CHIP_CLASS} bg-muted text-muted-foreground`}>Auth</span> : null}
          <SizableText size="xs" color="muted" className="min-w-0 truncate font-mono">
            {hostOf(server.url)}
          </SizableText>
          <ChevronRight
            className={`text-muted-foreground ml-auto size-3.5 shrink-0 transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
          />
        </button>
        {!readOnly ? (
          <div className={HOVER_ACTIONS_CLASS}>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={`Refresh ${server.name}`}
              disabled={refreshing}
              onClick={onRefresh}
            >
              {refreshing ? <Spinner size="small" /> : <RefreshCw className="size-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="iconSm"
              className="text-muted-foreground hover:text-destructive"
              aria-label={`Remove ${server.name}`}
              onClick={onRemove}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
      {unreachable ? (
        <SizableText size="xs" color="muted" className="truncate pl-7" title={server.status.error}>
          {server.status.error}
        </SizableText>
      ) : null}
      {expanded ? (
        <div className="border-border/60 mt-3 flex min-w-0 flex-col gap-0.5 border-t pt-2 pl-7">
          {tools.length === 0 ? (
            <SizableText size="xs" color="muted">
              {unreachable
                ? 'No tools known yet — refresh once the server is reachable.'
                : 'This server advertises no tools.'}
            </SizableText>
          ) : (
            tools.map((tool) => (
              <button
                key={tool.toolName}
                type="button"
                className="hover:bg-accent/40 -mx-2 flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1 text-left"
                onClick={() => onInspectTool(tool)}
              >
                <SizableText size="xs" className="shrink-0 font-mono">
                  {tool.name}
                </SizableText>
                <SizableText size="xs" color="muted" className="min-w-0 flex-1 truncate">
                  {toolSummary(tool)}
                </SizableText>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

/** Connects a remote MCP server: URL first (the name suggests itself from it), optional auth, transport under Advanced. */
function AddMcpServerDialog({
  input,
  onClose,
}: {
  input: {serverUrl: string | undefined; accountUid: string | null; onSaved?: (server: McpServerInfo) => void}
  onClose: () => void
}) {
  const saveServer = useSaveMcpServer(input.serverUrl, input.accountUid)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [authValue, setAuthValue] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [transport, setTransport] = useState<McpServerTransport | 'auto'>('auto')
  const [authHeader, setAuthHeader] = useState('Authorization')

  function handleUrlChange(next: string) {
    setUrl(next)
    if (!nameEdited) setName(suggestMcpServerName(next))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    try {
      const server = await saveServer.mutateAsync({
        name,
        url,
        transport: transport === 'auto' ? undefined : transport,
        authHeaderName: authHeader,
        authHeaderValue: authValue,
      })
      if (server.status.state === 'ok')
        toast.success(`Connected to ${server.name} · ${pluralTools(server.tools.length)}`)
      else toast.error(`Saved ${server.name}, but it could not be reached: ${server.status.error ?? 'unknown error'}`)
      input.onSaved?.(server)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the MCP server')
    }
  }

  const busy = saveServer.isLoading
  return (
    <form className="flex w-full max-w-md min-w-0 flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1">
        <DialogTitle>Add MCP server</DialogTitle>
        <DialogDescription>Its tools join this agent's toolbox the moment it connects.</DialogDescription>
      </div>
      <label className="flex flex-col gap-1.5">
        <SizableText size="sm" weight="bold">
          Server URL
        </SizableText>
        <Input
          value={url}
          onChange={(event) => handleUrlChange(event.target.value)}
          placeholder="https://mcp.example.com/mcp"
          type="url"
          required
          autoFocus
          disabled={busy}
        />
      </label>
      <div className="flex gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <SizableText size="sm" weight="bold">
            Name
          </SizableText>
          <Input
            className="font-mono"
            value={name}
            onChange={(event) => {
              setNameEdited(true)
              setName(event.target.value)
            }}
            placeholder="github"
            pattern="[a-z0-9][a-z0-9_-]{0,31}"
            title="Lowercase letters, digits, - or _"
            required
            disabled={busy}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <SizableText size="sm" weight="bold">
            {authHeader === 'Authorization' ? 'Authorization' : authHeader}{' '}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </SizableText>
          <Input
            type="password"
            value={authValue}
            onChange={(event) => setAuthValue(event.target.value)}
            placeholder="Bearer …"
            autoComplete="off"
            disabled={busy}
          />
        </label>
      </div>
      {advanced ? (
        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <SizableText size="sm" weight="bold">
              Transport
            </SizableText>
            <select
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              value={transport}
              onChange={(event) => setTransport(event.target.value as McpServerTransport | 'auto')}
              disabled={busy}
            >
              <option value="auto">Auto (HTTP, then SSE)</option>
              <option value="http">Streamable HTTP</option>
              <option value="sse">SSE</option>
            </select>
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <SizableText size="sm" weight="bold">
              Auth header name
            </SizableText>
            <Input
              className="font-mono"
              value={authHeader}
              onChange={(event) => setAuthHeader(event.target.value)}
              placeholder="Authorization"
              pattern="[A-Za-z0-9-]+"
              disabled={busy}
            />
          </label>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
          onClick={() => setAdvanced((value) => !value)}
        >
          {advanced ? 'Hide advanced' : 'Advanced'}
        </button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="default" disabled={busy || !url.trim() || !name.trim()}>
            {busy ? <Spinner size="small" /> : null}
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      </div>
    </form>
  )
}

function RemoveMcpServerDialog({
  input,
  onClose,
}: {
  input: {serverUrl: string | undefined; accountUid: string | null; server: McpServerInfo}
  onClose: () => void
}) {
  const deleteServer = useDeleteMcpServer(input.serverUrl, input.accountUid)
  async function handleRemove() {
    try {
      await deleteServer.mutateAsync(input.server.name)
      toast.success(`Removed ${input.server.name}`)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove the MCP server')
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <AlertDialogTitle>Remove {input.server.name}?</AlertDialogTitle>
      <AlertDialogDescription>
        Every agent on this account loses its tools, and its saved credentials are deleted.
      </AlertDialogDescription>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={onClose} disabled={deleteServer.isLoading}>
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction variant="destructive" onClick={() => void handleRemove()} disabled={deleteServer.isLoading}>
          Remove
        </AlertDialogAction>
      </AlertDialogFooter>
    </div>
  )
}

/** One remote tool's contract as the agent reads it: the document name, description, and input schema. */
function McpToolInfoDialog({input, onClose}: {input: {server: McpServerInfo; tool: McpToolInfo}; onClose: () => void}) {
  const {server, tool} = input
  return (
    <div className="flex max-h-[70vh] min-w-0 flex-col gap-4 overflow-y-auto">
      <div className="flex flex-col gap-1">
        <DialogTitle>{tool.name}</DialogTitle>
        <SizableText size="xs" color="muted" className="font-mono">
          call {tool.toolName}
        </SizableText>
      </div>
      <SizableText size="sm" color="muted">
        {tool.description?.trim() || `Tool "${tool.name}" from the ${server.name} MCP server.`}
      </SizableText>
      {tool.inputSchema ? (
        <div className="flex flex-col gap-1">
          <SizableText size="sm" weight="bold">
            Input schema
          </SizableText>
          <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs whitespace-pre">
            {JSON.stringify(tool.inputSchema, null, 2)}
          </pre>
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  )
}
