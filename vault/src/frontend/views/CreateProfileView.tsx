import {useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {Input} from '@/frontend/components/ui/input'
import {Label} from '@/frontend/components/ui/label'
import {Textarea} from '@/frontend/components/ui/textarea'
import {useActions, useAppState} from '@/frontend/store'
import {Plus} from 'lucide-react'

const MAX_AVATAR_BYTES = 1024 * 1024

/**
 * View for creating a profile after account security setup (Step 3 of 3).
 */
export function CreateProfileView() {
  const {loading, error, delegationRequest} = useAppState()
  const actions = useActions()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [nameError, setNameError] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | undefined>()
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null)
  const [avatarError, setAvatarError] = useState('')
  const [emailNotifs, setEmailNotifs] = useState(true)

  // Derive site name from delegation request's clientId
  const siteName = (() => {
    try {
      if (delegationRequest?.clientId) {
        return new URL(delegationRequest.clientId).hostname
      }
    } catch {
      // ignore invalid URLs
    }
    return 'Hypermedia'
  })()

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

    await actions.createAccount(trimmedName, description.trim() || undefined, avatarFile)

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
        <CardTitle className="text-left">
          <span className="text-muted-foreground font-normal">Step 3 of 3</span> — Create your profile
        </CardTitle>
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

          <div className="space-y-2">
            <Label htmlFor="profile-bio">Short bio (optional)</Label>
            <Textarea
              id="profile-bio"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 512))}
              placeholder="Type here"
              className="min-h-[80px] resize-none"
              disabled={loading}
            />
          </div>

          {/* Avatar upload */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="bg-muted relative flex size-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded">
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

          {/* Email notifications placeholder */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={emailNotifs}
              onChange={(e) => setEmailNotifs(e.target.checked)}
              className="size-4 shrink-0 rounded accent-brand-6"
            />
            Get email notifications about {siteName} activity.
          </label>

          <Button type="submit" className="w-full" loading={loading}>
            Start participating
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
