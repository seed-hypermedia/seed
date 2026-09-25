import {useExperiments} from '@/models/experiments'
import {useNavigate} from '@/utils/useNavigate'
import type {BrowserCommand, UnsignedAgentAction} from '@seed-hypermedia/agents-protocol'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {setAssistantBrowserStatus} from '@shm/ui/agents/assistant-window-context'
import {sendAgentAction} from '@shm/ui/agents/client'
import {Button} from '@shm/ui/button'
import {Globe, Loader2} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'

/** How long the panel waits for the user to answer an agent's request to open another website. */
const NAVIGATION_APPROVAL_TIMEOUT = 40_000

/** The http(s) origin of a URL, or null for Seed links and anything else. */
export function browserOrigin(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null
  } catch {
    return null
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

type PendingNavigation = {origin: string; answer: (approved: boolean) => void}

/**
 * Lets one agent session use the visible website, only after the user allows it.
 *
 * Access is off until the user allows a website. It covers only the websites the user allowed in
 * this panel; the Electron main process refuses commands on any other origin, and the agent must
 * ask before opening a new one. Only the agent's owner is offered access, and never on a public
 * agent, whose transcripts other people can read.
 */
export function BrowserAgentTools({
  serverUrl,
  sessionId,
  accountUid,
  toolEnabled,
  agentName,
  isOwner,
  isPublic,
}: {
  serverUrl: string
  sessionId: string
  accountUid: string
  toolEnabled: boolean
  agentName?: string
  isOwner: boolean
  isPublic: boolean
}) {
  const route = useNavRoute()
  const navigate = useNavigate()
  const enabled = useExperiments().data?.webBrowser === true
  const browserId = enabled && route.key === 'web' ? route.browserId : undefined
  const pageOrigin = route.key === 'web' ? browserOrigin(route.url) : null
  const [origins, setOrigins] = useState<string[]>([])
  const originsRef = useRef(origins)
  originsRef.current = origins
  const [paused, setPaused] = useState(false)
  const [revision, setRevision] = useState(0)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [error, setError] = useState<string>()
  const [draftId, setDraftId] = useState<string>()
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation>()
  const grantRef = useRef<{connectionId: string; browserId: number; accountUid: string}>()
  const available = browserId !== undefined && toolEnabled && isOwner && !isPublic
  const granted = origins.length > 0
  const pageAllowed = !!pageOrigin && origins.includes(pageOrigin)
  const agentLabel = agentName || 'This agent'
  const serverHost = hostOf(serverUrl)

  useEffect(() => {
    if (!available || !granted || paused) {
      setAssistantBrowserStatus(paused ? 'paused' : 'unavailable')
      return () => setAssistantBrowserStatus('unavailable')
    }
    const connectionId = crypto.randomUUID()
    let disposed = false
    const polling = new AbortController()
    const access = {connectionId, browserId: browserId!, accountUid}
    grantRef.current = access
    const send = (action: UnsignedAgentAction) =>
      sendAgentAction({
        serverUrl,
        accountUid,
        action,
        signal: action._ === 'PollSessionBrowser' ? polling.signal : AbortSignal.timeout(60000),
      })
    const disconnect = () => send({_: 'DisconnectSessionBrowser', sessionId, connectionId}).catch(() => {})
    const askToOpen = (origin: string) =>
      new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => answer(false), NAVIGATION_APPROVAL_TIMEOUT)
        const abort = () => answer(false)
        const answer = (approved: boolean) => {
          clearTimeout(timeout)
          polling.signal.removeEventListener('abort', abort)
          setPendingNavigation((pending) => (pending?.answer === answer ? undefined : pending))
          resolve(approved)
        }
        polling.signal.addEventListener('abort', abort, {once: true})
        setPendingNavigation({origin, answer})
      })
    const approveNavigation = async (command: BrowserCommand) => {
      if (command.action !== 'navigate') return
      const origin = browserOrigin(command.url)
      if (!origin || originsRef.current.includes(origin)) return
      if (!(await askToOpen(origin))) throw new Error(`The user did not allow opening ${origin}.`)
      const next = [...originsRef.current, origin]
      originsRef.current = next
      setOrigins(next)
      await window.browserAgent.access({...access, origins: next, enabled: true})
    }
    setStatus('connecting')
    setError(undefined)
    setAssistantBrowserStatus('connecting')
    void (async () => {
      try {
        await window.browserAgent.access({...access, origins: originsRef.current, enabled: true})
        if (disposed) return
        await send({_: 'ConnectSessionBrowser', sessionId, connectionId})
        if (disposed) {
          await disconnect()
          return
        }
        setStatus('connected')
        while (!disposed) {
          const response = await send({_: 'PollSessionBrowser', sessionId, connectionId})
          if (disposed) break
          if (response._ !== 'SessionBrowserResponse')
            throw new Error('Agent server does not support browser tools; update the server.')
          if (!response.request) continue
          const request = response.request
          let output: Record<string, unknown> | undefined
          let commandError: string | undefined
          try {
            await approveNavigation(request.command)
            if (disposed) break
            output = await window.browserAgent.execute(connectionId, request.command)
            if (!disposed && typeof output.draftId === 'string') setDraftId(output.draftId)
          } catch (error) {
            commandError = error instanceof Error ? error.message : String(error)
          }
          await send({
            _: 'ResolveSessionBrowser',
            sessionId,
            connectionId,
            requestId: request.id,
            ...(commandError ? {error: commandError} : {output}),
          })
        }
      } catch (error) {
        if (!disposed) {
          setStatus('error')
          setError(error instanceof Error ? error.message : String(error))
          setAssistantBrowserStatus('unavailable')
        }
      } finally {
        await window.browserAgent.access({...access, enabled: false}).catch(() => {})
        await disconnect()
      }
    })()
    return () => {
      disposed = true
      polling.abort()
      grantRef.current = undefined
      setAssistantBrowserStatus('unavailable')
      void window.browserAgent.access({...access, enabled: false}).catch(() => {})
      void disconnect()
    }
    // Allowing more websites updates the live grant below instead of reconnecting.
  }, [accountUid, available, browserId, granted, paused, revision, serverUrl, sessionId])

  // The context bubble reports "connected" only while the visible website is one the user allowed.
  useEffect(() => {
    if (available && granted && !paused && status === 'connected')
      setAssistantBrowserStatus(pageAllowed ? 'connected' : 'unavailable')
  }, [available, granted, pageAllowed, paused, status])

  const allowPage = () => {
    if (!pageOrigin || originsRef.current.includes(pageOrigin)) return
    const next = [...originsRef.current, pageOrigin]
    originsRef.current = next
    setOrigins(next)
    setPaused(false)
    const grant = grantRef.current
    if (grant) void window.browserAgent.access({...grant, origins: next, enabled: true}).catch(() => {})
  }

  if (browserId === undefined) return null
  if (!isOwner || isPublic) {
    return (
      <div className="text-muted-foreground border-border border-t px-3 py-2 text-xs">
        {isPublic
          ? 'Browser access is not available for public agents. Other people can read their sessions.'
          : 'Browser access is only available for agents you own.'}
      </div>
    )
  }
  if (!toolEnabled)
    return (
      <div className="text-muted-foreground border-border border-t px-3 py-2 text-xs">
        Browser access is disabled in this agent’s tool settings.
      </div>
    )
  if (pendingNavigation)
    return (
      <div className="border-border bg-muted/30 border-t px-3 py-2 text-xs" role="alertdialog">
        <p>
          {agentLabel} wants to open <strong>{pendingNavigation.origin}</strong> and use it with your signed-in session.
        </p>
        <div className="mt-2 flex gap-2">
          <Button size="xs" variant="outline" onClick={() => pendingNavigation.answer(true)}>
            Allow
          </Button>
          <Button size="xs" variant="ghost" onClick={() => pendingNavigation.answer(false)}>
            Deny
          </Button>
        </div>
      </div>
    )
  if (!pageAllowed)
    return (
      <div className="border-border bg-muted/30 border-t px-3 py-2 text-xs">
        <p>
          Let <strong>{agentLabel}</strong> on {serverHost} read, screenshot and act on{' '}
          <strong>{pageOrigin ?? 'this page'}</strong>? It uses your signed-in session there, and what it reads is sent
          to the agent server.
        </p>
        {granted ? (
          <p className="text-muted-foreground mt-1">Access covers only the websites you allowed in this session.</p>
        ) : null}
        <Button className="mt-2" size="xs" variant="outline" disabled={!pageOrigin} onClick={allowPage}>
          Allow on this website
        </Button>
      </div>
    )
  return (
    <div className="border-border bg-muted/30 border-t px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        {!paused && status === 'connecting' ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Globe className="size-3" />
        )}
        <span className="flex-1">
          {paused
            ? 'Browser access paused'
            : status === 'connected'
              ? `Browser connected to ${pageOrigin}`
              : status === 'error'
                ? 'Browser unavailable'
                : 'Connecting browser…'}
        </span>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            if (!paused && status === 'error') setRevision((value) => value + 1)
            else setPaused((value) => !value)
          }}
        >
          {paused ? 'Resume' : status === 'error' ? 'Reconnect' : 'Pause'}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            originsRef.current = []
            setOrigins([])
            setPaused(false)
          }}
        >
          Revoke
        </Button>
      </div>
      <p className="text-muted-foreground mt-1">
        {paused
          ? 'No new browser commands will run while paused. Previously shared content remains in the session.'
          : error
            ? error
            : `${agentLabel} can read, screenshot and act on ${origins.join(
                ', ',
              )}, including signed-in content. Shared with ${serverHost}.`}
      </p>
      {draftId ? (
        <Button className="mt-2" size="xs" variant="outline" onClick={() => navigate({key: 'draft', id: draftId})}>
          Review archived draft
        </Button>
      ) : null}
    </div>
  )
}
