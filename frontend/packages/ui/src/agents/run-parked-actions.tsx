/**
 * The way to answer a run that is waiting on you.
 *
 * A parked run is the one state where the machine has stopped and is asking a person a question —
 * an approval it needs, a budget it has spent. Showing that state without a way to answer it is the
 * worst version of this UI: the user reads "waiting for sign-off" and has nowhere to click. This is
 * the answer, in the smallest form that is honestly useful — one button, and a payload field only
 * for the runs that can use one.
 *
 * Shared by every surface that shows a live run: the pinned card and the expanded delegate bubble
 * both compose it, so a wait looks and behaves the same wherever it is met.
 */
import type {RunInfo} from './client'
import {useSignalRun} from './models'
import {Button} from '@shm/ui/button'
import {toast} from '@shm/ui/toast'
import {useState} from 'react'

/** The signal that releases a budget pause; the server accepts any name for that wait. */
const RESUME_SIGNAL = 'resume'

/**
 * What a person can do about this run right now, or null when the answer is "nothing" — a run that
 * is working, sleeping, waiting on its own children, or watching the activity feed is not asking
 * anybody for anything.
 */
function pendingAsk(run: RunInfo): {kind: 'answer'; signal: string} | {kind: 'resume'} | null {
  if (run.status !== 'waiting') return null
  if (run.wait?.reason === 'budget-pause') return {kind: 'resume'}
  if (run.wait?.reason === 'event' && run.wait.answerWith) return {kind: 'answer', signal: run.wait.answerWith}
  return null
}

export function ParkedRunActions({
  run,
  serverUrl,
  accountUid,
}: {
  run: RunInfo
  serverUrl: string
  accountUid: string | null | undefined
}) {
  const ask = pendingAsk(run)
  const signalRun = useSignalRun(serverUrl, accountUid)
  // Collapsed by default: the common answer is "yes, go ahead", and making that one click is worth
  // more than making the rare structured reply one click.
  const [payloadOpen, setPayloadOpen] = useState(false)
  const [payloadText, setPayloadText] = useState('')

  if (!ask) return null

  const send = (payload?: unknown) => {
    signalRun.mutate(
      {
        runId: run.id,
        signal: ask.kind === 'resume' ? RESUME_SIGNAL : ask.signal,
        ...(payload === undefined ? {} : {payload}),
      },
      {
        onSuccess: (result) => {
          // Not delivered is not an error: the run moved on while the card was open.
          if (result.delivered) {
            setPayloadOpen(false)
            setPayloadText('')
          } else {
            toast.error('This run is no longer waiting for that')
          }
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not reach the run'),
      },
    )
  }

  const sendTypedPayload = () => {
    const text = payloadText.trim()
    if (!text) return send()
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      toast.error('That is not valid JSON')
      return
    }
    send(payload)
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" disabled={signalRun.isPending} onClick={() => (payloadOpen ? sendTypedPayload() : send())}>
          {signalRun.isPending ? 'Sending…' : ask.kind === 'resume' ? 'Resume' : 'Answer'}
        </Button>
        {ask.kind === 'answer' ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-[11px] underline-offset-2 hover:underline"
            onClick={() => setPayloadOpen((open) => !open)}
          >
            {payloadOpen ? 'Just answer' : 'Answer with data'}
          </button>
        ) : null}
        {ask.kind === 'answer' && run.wait?.label ? (
          <span className="text-muted-foreground min-w-0 truncate text-[11px]">{run.wait.label}</span>
        ) : null}
      </div>
      {payloadOpen && ask.kind === 'answer' ? (
        <textarea
          value={payloadText}
          onChange={(event) => setPayloadText(event.target.value)}
          placeholder='JSON the run will receive, e.g. {"approved": true}'
          rows={3}
          spellCheck={false}
          className="bg-background/60 min-w-0 rounded-md border p-2 font-mono text-[11px]"
        />
      ) : null}
    </div>
  )
}
