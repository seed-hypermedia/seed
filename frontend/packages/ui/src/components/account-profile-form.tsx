import {User} from 'lucide-react'
import {useEffect, useState, type FormEvent} from 'react'
import {Button} from '../button'
import {SizableText} from '../text'
import {Input} from './input'
import {Label} from './label'
import {Textarea} from './textarea'

const MAX_AVATAR_BYTES = 1024 * 1024

export type AccountProfileFormValues = {
  name: string
  description?: string
  /** Newly selected avatar image, if the user picked one. */
  imageFile?: File
}

/**
 * Shared, backend-agnostic account profile form (avatar + name + optional
 * description + optional email-notification opt-in). Used by both the web vault
 * and the desktop app so the create/edit account dialogs are identical.
 *
 * Each platform wraps this in its own dialog chrome and handles persistence: it
 * passes the already-resolved `initialImageUrl` for an existing avatar and
 * receives the picked `imageFile` back on submit (to upload however it likes).
 * Uses only @shm/ui primitives — no app-context, router, or form-library deps —
 * so the lean vault can consume it.
 */
export function AccountProfileForm({
  initialName = '',
  initialDescription = '',
  initialImageUrl = '',
  showDescription = true,
  submitLabel = 'Save',
  loading,
  error,
  notificationOption,
  onCancel,
  onSubmit,
}: {
  initialName?: string
  initialDescription?: string
  /** Resolved URL of the existing avatar (the platform resolves it from its store). */
  initialImageUrl?: string
  showDescription?: boolean
  submitLabel?: string
  loading?: boolean
  error?: string
  notificationOption?: {
    label: string
    description: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }
  onCancel?: () => void
  onSubmit: (values: AccountProfileFormValues) => void | boolean | Promise<void> | Promise<boolean>
}) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [nameError, setNameError] = useState('')
  const [avatarError, setAvatarError] = useState('')
  const [imageFile, setImageFile] = useState<File | undefined>()
  const [previewUrl, setPreviewUrl] = useState(initialImageUrl)

  // Reset when the initial values change (dialog reopened for a different account).
  useEffect(() => {
    setName(initialName)
    setDescription(initialDescription)
    setNameError('')
    setAvatarError('')
    setImageFile(undefined)
    setPreviewUrl(initialImageUrl)
  }, [initialName, initialDescription, initialImageUrl])

  useEffect(() => {
    if (!imageFile) return
    const objectUrl = URL.createObjectURL(imageFile)
    setPreviewUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [imageFile])

  function handleImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size >= MAX_AVATAR_BYTES) {
      setImageFile(undefined)
      setPreviewUrl(initialImageUrl)
      setAvatarError('Image must be smaller than 1 MiB')
      return
    }
    setAvatarError('')
    setImageFile(file)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameError('Name is required')
      return
    }
    if (avatarError) return
    setNameError('')
    await onSubmit({
      name: trimmedName,
      description: showDescription ? description.trim() || undefined : undefined,
      imageFile,
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-col gap-4">
        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor="account-profile-image">Avatar (optional)</Label>
          <div className="flex items-start gap-4">
            <div className="bg-muted flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full">
              {previewUrl ? (
                <img src={previewUrl} className="size-full object-cover" alt="" />
              ) : (
                <User className="text-muted-foreground size-6" />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Input
                id="account-profile-image"
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                disabled={loading}
              />
              <SizableText size="xs" color="muted">
                Upload an image smaller than 1 MiB.
              </SizableText>
              {avatarError ? <p className="text-destructive text-sm">{avatarError}</p> : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="account-profile-name">Name</Label>
          <Input
            id="account-profile-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              if (nameError) setNameError('')
            }}
            placeholder="Display name"
            autoFocus
            disabled={loading}
          />
          {nameError ? <p className="text-destructive text-sm">{nameError}</p> : null}
        </div>

        {showDescription ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="account-profile-description">Description (optional)</Label>
            <Textarea
              id="account-profile-description"
              value={description}
              onChange={(event) => setDescription(event.target.value.slice(0, 512))}
              placeholder="A short bio or description"
              className="min-h-[80px] resize-none"
              disabled={loading}
            />
            <SizableText size="xs" color="muted" className="text-right">
              {description.length}/512
            </SizableText>
          </div>
        ) : null}

        {notificationOption ? (
          <div className="rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <input
                id="account-profile-notification-email"
                type="checkbox"
                checked={notificationOption.checked}
                onChange={(event) => notificationOption.onCheckedChange(event.target.checked)}
                disabled={loading}
                className="mt-0.5 size-4 shrink-0 rounded"
              />
              <div className="flex flex-col gap-1">
                <Label htmlFor="account-profile-notification-email">{notificationOption.label}</Label>
                <SizableText size="sm" color="muted">
                  {notificationOption.description}
                </SizableText>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-2 flex justify-end gap-3">
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" loading={loading}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  )
}
