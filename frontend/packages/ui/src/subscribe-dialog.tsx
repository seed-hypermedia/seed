import {NOTIFY_SERVICE_HOST, SEED_HOST_URL} from '@shm/shared/constants'
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
  siteUrl?: string
}

export function SubscribeDialog({
  open,
  onOpenChange,
  accountId,
  siteUrl,
}: SubscribeDialogProps) {
  const [email, setEmail] = useState('')
  const [isChecked, setIsChecked] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isMobileKeyboardOpen, setIsMobileKeyboardOpen] = useState(false)

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

  const handleSaveEmail = async () => {
    if (!accountId) {
      setError('Site information not available')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const apiHost = NOTIFY_SERVICE_HOST || siteUrl || SEED_HOST_URL
      const apiUrl = `${apiHost}/hm/api/public-subscribe`

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'subscribe',
          email,
          accountId,
          notifyAllMentions: isChecked,
          notifyAllReplies: isChecked,
          notifyOwnedDocChange: isChecked,
          notifySiteDiscussions: isChecked,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to subscribe')
      }

      // Success - close dialog and reset form
      setEmail('')
      setIsChecked(false)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to subscribe')
    } finally {
      setIsLoading(false)
    }
  }

  const isSaveDisabled = !email.trim() || !isChecked

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
              disabled={isLoading}
            />
          </div>

          <CheckboxField
            id="notifications"
            checked={isChecked}
            onCheckedChange={(checked: boolean) =>
              setIsChecked(checked === true)
            }
            variant="primary"
          >
            Get notified about site activity (discussions, document changes) and
            user activity (mentions, replies, comments).
          </CheckboxField>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSaveEmail}
            disabled={isSaveDisabled || isLoading}
            variant="default"
          >
            {isLoading ? 'Subscribing...' : 'Save Email'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
