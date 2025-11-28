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

export function CopiedToast({
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
      baseMessage="Copied URL"
      errorMessage={errorMessage}
    />
  )
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
    statusMessage += ' and pushed to all sites.'
  } else if (status === 'error') {
    statusMessage +=
      ' but failed to push. Your content will be distributed eventually.'
  } else {
    // loading
    statusMessage += '. Now pushing to sites:'
  }
  return (
    <>
      {errorMessage ? (
        <p className="">{errorMessage}</p>
      ) : (
        <p>{statusMessage}</p>
      )}
      {hosts.map(({host, peerId, message, status}) => {
        return (
          <p
            key={host}
            className={
              status === 'error' ? 'text-destructive' : 'text-muted-foreground'
            }
          >
            <span>{hostnameStripProtocol(host)}</span>
            <span className="font-thin">{` - ${message || 'Syncing...'}`}</span>
          </p>
        )
      })}
    </>
  )
}
