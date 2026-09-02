import {hostnameStripProtocol, StateStream} from '@shm/shared'
import {useStream} from '@shm/shared/use-stream'

export type PushResourceStatus = {
  hosts: {
    host: string
    status: 'success' | 'error' | 'pending'
    peerId?: string
    message?: string
  }[]
}

/** Counts of completed (success or error) and total destination hosts. */
export function pushProgress(state: PushResourceStatus | null | undefined): {done: number; total: number} {
  const total = state?.hosts.length ?? 0
  const done = state?.hosts.filter((h) => h.status === 'success' || h.status === 'error').length ?? 0
  return {done, total}
}

/**
 * Compact push-status toast for the "copy link" action. Shows a single
 * summary line; during loading it surfaces progress as "(done/total)" once
 * destination hosts are known.
 */
export function CopiedToast({
  pushStatus,
  status,
  errorMessage,
}: {
  pushStatus: StateStream<PushResourceStatus | null>
  status: 'loading' | 'success' | 'error'
  errorMessage?: string
}) {
  const state = useStream(pushStatus)
  const {done, total} = pushProgress(state)
  if (status === 'loading') {
    const progress = total > 0 ? ` (${done}/${total})` : ''
    return <p>{`Copied URL. Pushing…${progress}`}</p>
  }
  if (status === 'success') {
    const suffix = total > 0 ? ` to ${total} server${total === 1 ? '' : 's'}` : ' to servers'
    return <p>{`Copied URL. Pushed${suffix}`}</p>
  }
  return <p>{errorMessage ? `Copied URL. Failed to push: ${errorMessage}` : 'Copied URL. Failed to push to servers'}</p>
}

export function PublishedToast({
  pushStatus,
  status,
  errorMessage,
}: {
  pushStatus: StateStream<PushResourceStatus | null>
  status: 'loading' | 'success' | 'error'
  errorMessage?: string
}) {
  return (
    <PushToast
      pushStatus={pushStatus}
      status={status}
      baseMessage="Published on your node"
      errorMessage={errorMessage}
    />
  )
}

export function PushToast({
  pushStatus,
  status,
  baseMessage,
  errorMessage,
}: {
  pushStatus: StateStream<PushResourceStatus | null>
  status: 'loading' | 'success' | 'error'
  baseMessage: string
  errorMessage?: string
}) {
  const state = useStream(pushStatus)
  const hosts = state?.hosts || []
  let statusMessage = baseMessage
  if (status === 'success') {
    statusMessage += ' and pushed to all spaces.'
  } else if (status === 'error') {
    statusMessage += ' but failed to push. Your content will be distributed eventually.'
  } else {
    // loading
    statusMessage += '. Now pushing to spaces:'
  }
  return (
    <>
      {errorMessage ? <p className="">{errorMessage}</p> : <p>{statusMessage}</p>}
      {hosts.map(({host, message, status}) => {
        return (
          <p key={host} className={status === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
            <span>{hostnameStripProtocol(host)}</span>
            <span className="font-thin">{` - ${message || 'Syncing...'}`}</span>
          </p>
        )
      })}
    </>
  )
}
