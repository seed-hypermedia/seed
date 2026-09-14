import {useExperiments} from '@/models/experiments'
import {useNavigate} from '@/utils/useNavigate'
import type {UnsignedAgentAction} from '@seed-hypermedia/agents-protocol'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {setAssistantBrowserStatus} from '@shm/ui/agents/assistant-window-context'
import {sendAgentAction} from '@shm/ui/agents/client'
import {Button} from '@shm/ui/button'
import {Globe, Loader2} from 'lucide-react'
import {useEffect, useState} from 'react'

/** Connects only this panel's session to the visible guest, with explicit status, pause, and draft review controls. */
export function BrowserAgentTools({
  serverUrl,
  sessionId,
  accountUid,
  toolEnabled,
}: {
  serverUrl: string
  sessionId: string
  accountUid: string
  toolEnabled: boolean
}) {
  const route = useNavRoute()
  const navigate = useNavigate()
  const enabled = useExperiments().data?.webBrowser === true
  const browserId = enabled && route.key === 'web' ? route.browserId : undefined
  const [paused, setPaused] = useState(false)
  const [revision, setRevision] = useState(0)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [error, setError] = useState<string>()
  const [draftId, setDraftId] = useState<string>()

  useEffect(() => {
    if (browserId === undefined || paused || !toolEnabled) {
      setAssistantBrowserStatus(paused ? 'paused' : 'unavailable')
      return () => setAssistantBrowserStatus('unavailable')
    }
    const connectionId = crypto.randomUUID()
    let disposed = false
    const polling = new AbortController()
    const access = {connectionId, browserId, accountUid}
    const send = (action: UnsignedAgentAction) =>
      sendAgentAction({
        serverUrl,
        accountUid,
        action,
        signal: action._ === 'PollSessionBrowser' ? polling.signal : AbortSignal.timeout(60000),
      })
    const disconnect = () => send({_: 'DisconnectSessionBrowser', sessionId, connectionId}).catch(() => {})
    setStatus('connecting')
    setError(undefined)
    setAssistantBrowserStatus('connecting')
    void (async () => {
      try {
        await window.browserAgent.access({...access, enabled: true})
        if (disposed) return
        await send({_: 'ConnectSessionBrowser', sessionId, connectionId})
        if (disposed) {
          await disconnect()
          return
        }
        setStatus('connected')
        setAssistantBrowserStatus('connected')
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
      setAssistantBrowserStatus('unavailable')
      void window.browserAgent.access({...access, enabled: false}).catch(() => {})
      void disconnect()
    }
  }, [accountUid, browserId, paused, revision, serverUrl, sessionId, toolEnabled])

  if (browserId === undefined) return null
  if (!toolEnabled)
    return (
      <div className="text-muted-foreground border-border border-t px-3 py-2 text-xs">
        Browser access is disabled in this agent’s tool settings.
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
              ? 'Browser connected'
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
      </div>
      <p className="text-muted-foreground mt-1">
        {paused
          ? 'No new browser commands will run while paused. Previously shared content remains in the session.'
          : error
            ? error
            : 'This session can read, screenshot and act on this page, including signed-in content. Shared with the agent server.'}
      </p>
      {draftId ? (
        <Button className="mt-2" size="xs" variant="outline" onClick={() => navigate({key: 'draft', id: draftId})}>
          Review archived draft
        </Button>
      ) : null}
    </div>
  )
}
