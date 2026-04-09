import {useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {Input} from '@/frontend/components/ui/input'
import {Label} from '@/frontend/components/ui/label'
import {StepIndicator} from '@/frontend/components/StepIndicator'
import {useActions, useAppState} from '@/frontend/store'
import {Plus} from 'lucide-react'

const MAX_AVATAR_BYTES = 1024 * 1024

/**
 * View for creating a profile after account security setup (Step 3 of 3).
 */
export function CreateProfileView() {
  const {loading, error, delegationRequest, session, email} = useAppState()
  const actions = useActions()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [nameError, setNameError] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | undefined>()
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null)
  const [avatarError, setAvatarError] = useState('')
  const [shareEmailWithNotificationServer, setShareEmailWithNotificationServer] = useState(true)
  const sessionEmail = session?.email?.trim() || email.trim()
  const notificationEmailLabel = sessionEmail ? `Notify me at ${sessionEmail}` : 'Notify me by email'

  useEffect(() => {
    if (!avatarFile) return
    const objectUrl = URL.createObjectURL(avatarFile)
    setAvatarPreviewUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [avatarFile])

  function handleAvatarChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    if (file.size >= MAX_AVATAR_BYTES) {
      setAvatarFile(undefined)
      setAvatarPreviewUrl(null)
      setAvatarError('Image must be smaller than 1 MiB')
      return
    }

    setAvatarError('')
    setAvatarFile(file)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameError('Name is required')
      return
    }
    setNameError('')

    const didCreateAccount = await actions.createAccount(trimmedName, undefined, avatarFile, {
      notificationRegistration: {
        includeEmail: shareEmailWithNotificationServer,
      },
    })

    if (!didCreateAccount) {
      return
    }

    // Navigate to delegation consent if there's a pending request, otherwise to dashboard
    if (delegationRequest) {
      navigate('/delegate')
    } else {
      navigate('/')
    }
  }

  return (
    <Card>
      <CardHeader>
        <StepIndicator currentStep={3} />
        <CardTitle className="text-left text-xl">Create your profile</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-6 text-sm">Add a name and short bio so people recognize you.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <ErrorMessage message={error} />

          <div className="space-y-2">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (nameError) setNameError('')
              }}
              placeholder="Type here"
              autoFocus
              disabled={loading}
            />
            {nameError && <p className="text-destructive text-sm">{nameError}</p>}
          </div>

          {/* Avatar upload */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="bg-muted focus-within:ring-primary relative flex size-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded focus-within:ring-2 focus-within:ring-offset-2">
                {avatarPreviewUrl ? (
                  <img src={avatarPreviewUrl} className="size-full object-cover" alt="" />
                ) : (
                  <Plus className="text-muted-foreground size-5" />
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  disabled={loading}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </div>
              <span className="text-muted-foreground text-sm">Add a photo (optional)</span>
            </div>
            {avatarError && <p className="text-destructive text-sm">{avatarError}</p>}
          </div>

          <div className="rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <input
                id="profile-notification-email"
                type="checkbox"
                checked={shareEmailWithNotificationServer}
                onChange={(event) => setShareEmailWithNotificationServer(event.target.checked)}
                disabled={loading}
                className="mt-0.5 size-4 shrink-0 rounded"
              />
              <div className="space-y-1">
                <Label htmlFor="profile-notification-email">{notificationEmailLabel}</Label>
                <p className="text-muted-foreground text-sm">
                  Leave this on to register notifications with that email. If you turn it off, your account will still
                  be registered without an email address.
                </p>
              </div>
            </div>
          </div>

          <Button type="submit" className="w-full" loading={loading}>
            Start participating
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
