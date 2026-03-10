import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {Button} from '@/frontend/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/frontend/components/ui/dialog'
import {Input} from '@/frontend/components/ui/input'
import {Label} from '@/frontend/components/ui/label'
import {Textarea} from '@/frontend/components/ui/textarea'
import {getProfileAvatarImageSrc} from '@/frontend/profile'
import {useAppState} from '@/frontend/store'
import {User} from 'lucide-react'
import {useEffect, useState} from 'react'

const MAX_AVATAR_BYTES = 1024 * 1024

export function AccountProfileDialog({
  open,
  onOpenChange,
  title,
  descriptionText,
  submitLabel,
  loading,
  error,
  initialName = '',
  initialDescription = '',
  initialAvatar,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  descriptionText: string
  submitLabel: string
  loading?: boolean
  error?: string
  initialName?: string
  initialDescription?: string
  initialAvatar?: string
  onSubmit: (values: {
    name: string
    description?: string
    avatarFile?: File
  }) => Promise<void> | Promise<boolean> | void | boolean
}) {
  const {backendBaseUrl} = useAppState()
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [nameError, setNameError] = useState('')
  const [avatarError, setAvatarError] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | undefined>()
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState(() =>
    getProfileAvatarImageSrc(backendBaseUrl, initialAvatar),
  )

  useEffect(() => {
    if (!open) {
      setNameError('')
      setAvatarError('')
      setAvatarFile(undefined)
      setAvatarPreviewUrl(getProfileAvatarImageSrc(backendBaseUrl, initialAvatar))
      return
    }

    setName(initialName)
    setDescription(initialDescription)
    setNameError('')
    setAvatarError('')
    setAvatarFile(undefined)
    setAvatarPreviewUrl(getProfileAvatarImageSrc(backendBaseUrl, initialAvatar))
  }, [backendBaseUrl, initialAvatar, initialDescription, initialName, open])

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
      setAvatarPreviewUrl(getProfileAvatarImageSrc(backendBaseUrl, initialAvatar))
      setAvatarError('Avatar must be smaller than 1 MiB')
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
    if (avatarError) {
      return
    }

    setNameError('')
    await onSubmit({
      name: trimmedName,
      description: description.trim() || undefined,
      avatarFile,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{descriptionText}</DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <ErrorMessage message={error ?? ''} className="mb-0" />

            <div className="space-y-2">
              <Label htmlFor="account-profile-avatar">Avatar (optional)</Label>
              <div className="flex items-start gap-4">
                <div className="bg-muted flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full">
                  {avatarPreviewUrl ? (
                    <img src={avatarPreviewUrl} className="size-full object-cover" alt="" />
                  ) : (
                    <User className="text-muted-foreground size-6" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <Input
                    id="account-profile-avatar"
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarChange}
                    disabled={loading}
                  />
                  <p className="text-muted-foreground text-xs">Upload an image smaller than 1 MiB.</p>
                  {avatarError && <p className="text-destructive text-sm">{avatarError}</p>}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-profile-name">Name</Label>
              <Input
                id="account-profile-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (nameError) setNameError('')
                }}
                placeholder="Display name"
                autoFocus
                disabled={loading}
              />
              {nameError && <p className="text-destructive text-sm">{nameError}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-profile-description">Description (optional)</Label>
              <Textarea
                id="account-profile-description"
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 512))}
                placeholder="A short bio or description"
                className="min-h-[80px] resize-none"
                disabled={loading}
              />
              <p className="text-muted-foreground text-right text-xs">{description.length}/512</p>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
