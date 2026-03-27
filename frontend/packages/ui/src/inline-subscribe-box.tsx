import {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {useSubscribeToNotifications} from '@shm/shared/models/email-notifications'
import {useState} from 'react'
import {Button} from './button'
import {Input} from './components/input'
import {cn} from './utils'

interface InlineSubscribeBoxProps {
  accountId: string
  notifyServiceHost: string
  accountMeta?: HMMetadata
  className?: string
}

export function InlineSubscribeBox({accountId, notifyServiceHost, accountMeta, className}: InlineSubscribeBoxProps) {
  const [email, setEmail] = useState('')
  const [successEmail, setSuccessEmail] = useState<string | null>(null)
  const {mutate, isPending, error: mutationError} = useSubscribeToNotifications()

  const error = mutationError instanceof Error ? mutationError.message : null

  const handleSubscribe = () => {
    if (!email.trim()) return
    mutate(
      {
        notifyServiceHost,
        action: 'subscribe',
        email,
        accountId,
        notifyOwnedDocChange: true,
        notifySiteDiscussions: true,
      },
      {
        onSuccess: () => {
          setSuccessEmail(email)
          setEmail('')
        },
      },
    )
  }

  if (successEmail) {
    return (
      <div
        className={cn(
          'mx-auto my-6 max-w-2xl rounded-lg border border-green-200 bg-green-50 px-6 py-5 dark:border-green-800 dark:bg-green-950',
          className,
        )}
      >
        <p className="text-sm text-green-800 dark:text-green-200">
          <span className="font-semibold">{successEmail}</span> will be notified when{' '}
          <span className="font-semibold">{accountMeta?.name || 'this site'}</span> is updated.
        </p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'mx-auto my-6 max-w-2xl rounded-lg border border-yellow-200 bg-yellow-50 px-6 py-5 dark:border-yellow-200/30 dark:bg-yellow-50/10',
        className,
      )}
    >
      <p className="text-foreground mb-3 text-base font-semibold">
        Do you like what you are reading?. Subscribe to receive updates.
      </p>
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          disabled={isPending}
          className="flex-1 bg-white dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-400"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubscribe()
          }}
        />
        <Button
          variant="brand"
          size="sm"
          onClick={handleSubscribe}
          disabled={!email.trim() || isPending}
          className="plausible-event-name=inline-subscribe text-white"
        >
          {isPending ? 'Subscribing...' : 'Subscribe'}
        </Button>
      </div>
      <p className="text-muted-foreground mt-2 text-xs">Unsubscribe anytime</p>
    </div>
  )
}
