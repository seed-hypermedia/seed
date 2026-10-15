import {Button} from '@/frontend/components/ui/button'
import * as navigation from '@/frontend/navigation'
import {useAppState} from '@/frontend/store'

/**
 * Reminder for a password user without recovery words, if sign-up was left before
 * saving them, or the account predates them. Renders nothing otherwise.
 */
export function RecoveryWordsReminder() {
  const {session} = useAppState()
  const navigate = navigation.useHashNavigate()

  if (!session?.credentials?.password || session.credentials.recoveryWords) {
    return null
  }

  return (
    <div className="border-brand/40 bg-brand/5 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
      <div className="min-w-60 flex-1 space-y-1">
        <p className="font-semibold">Save your recovery words</p>
        <p className="text-muted-foreground text-sm">
          If you forget your password, recovery words are how you get back into your account.
        </p>
      </div>
      <Button className="shrink-0" onClick={() => navigate('/settings/recovery-words')}>
        Save recovery words
      </Button>
    </div>
  )
}
