import {HMMetadata} from '@shm/shared/hm-types'
import {useSubscribeToNotifications} from '@shm/shared/models/email-notifications'
import {useEffect, useState} from 'react'
import {Button} from './button'
import {CheckboxField} from './components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/dialog'
import {Input} from './components/input'
import {Label} from './components/label'
import {cn} from './utils'

interface SubscribeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId?: string
  accountMeta?: HMMetadata
  notifyServiceHost?: string
}

export function SubscribeDialog({
  open,
  onOpenChange,
  accountId,
  accountMeta,
  notifyServiceHost,
}: SubscribeDialogProps) {
  const [email, setEmail] = useState('')
  const [isChecked, setIsChecked] = useState(true)
  const [isMobileKeyboardOpen, setIsMobileKeyboardOpen] = useState(false)
  const [successEmail, setSuccessEmail] = useState<string | null>(null)

  const {
    mutate,
    isPending,
    error: mutationError,
  } = useSubscribeToNotifications()

  const error = mutationError instanceof Error ? mutationError.message : null

  // Handle mobile keyboard detection
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleResize = () => {
      // Detect if mobile keyboard is open
      const initialViewportHeight = window.innerHeight
      const currentViewportHeight =
        window.visualViewport?.height || window.innerHeight
      const heightDifference = initialViewportHeight - currentViewportHeight

      setIsMobileKeyboardOpen(heightDifference > 150)
    }

    // Listen for viewport changes (mobile keyboard)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize)
    } else {
      window.addEventListener('resize', handleResize)
    }

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize)
      } else {
        window.removeEventListener('resize', handleResize)
      }
    }
  }, [])
  if (!notifyServiceHost) {
    return null
  }

  const handleSaveEmail = () => {
    if (!accountId) {
      return
    }

    mutate(
      {
        notifyServiceHost,
        action: 'subscribe',
        email,
        accountId,
        notifyAllMentions: isChecked,
        notifyAllReplies: isChecked,
        notifyOwnedDocChange: isChecked,
        notifySiteDiscussions: isChecked,
      },
      {
        onSuccess: () => {
          // Success - close dialog and reset form
          setEmail('')
          setIsChecked(false)
          setSuccessEmail(email)
        },
      },
    )
  }

  const isSaveDisabled = !email.trim() || !isChecked || !accountId

  let dialogContent = successEmail ? (
    <>
      <DialogHeader>
        <DialogTitle>Successfully Subscribed!</DialogTitle>
      </DialogHeader>
      <p>
        <span className="font-bold">{successEmail}</span> will be notified when{' '}
        <span className="font-bold">{accountMeta?.name || 'this site'}</span> is
        updated, and when new discussions are created.
      </p>
      <p>
        You can unsubscribe or change notification settings by clicking the link
        included in every email.
      </p>
      <DialogFooter>
        <Button
          onClick={() => {
            onOpenChange(false)
            setSuccessEmail(null)
          }}
          variant="default"
        >
          Done
        </Button>
      </DialogFooter>
    </>
  ) : (
    <>
      <DialogHeader>
        <DialogTitle>Subscribe And Get Notified</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="example@email.com"
            value={email}
            onChangeText={setEmail}
            disabled={isPending}
          />
        </div>

        <CheckboxField
          id="notifications"
          checked={isChecked}
          onCheckedChange={(checked: boolean) => setIsChecked(checked === true)}
          variant="primary"
        >
          Get notified about site activity (discussions, document changes) and
          user activity (mentions, replies, comments).
        </CheckboxField>
      </div>

      <DialogFooter>
        <Button
          onClick={handleSaveEmail}
          disabled={isSaveDisabled || isPending}
          variant="default"
        >
          {isPending ? 'Subscribing...' : 'Save Email'}
        </Button>
      </DialogFooter>
    </>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'sm:max-w-md',
          isMobileKeyboardOpen
            ? 'max-sm:top-[2vh] max-sm:max-h-[60vh] max-sm:translate-y-0'
            : 'max-sm:top-[5vh] max-sm:max-h-[90vh] max-sm:translate-y-0',
        )}
      >
        {dialogContent}
      </DialogContent>
    </Dialog>
  )
}
