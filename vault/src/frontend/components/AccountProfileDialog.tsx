import {useEffect, useState} from 'react'
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
  onSubmit: (values: {name: string; description?: string}) => Promise<void> | Promise<boolean> | void | boolean
}) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [nameError, setNameError] = useState('')

  useEffect(() => {
    if (!open) {
      setNameError('')
      return
    }

    setName(initialName)
    setDescription(initialDescription)
    setNameError('')
  }, [initialDescription, initialName, open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameError('Name is required')
      return
    }

    setNameError('')
    await onSubmit({
      name: trimmedName,
      description: description.trim() || undefined,
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
