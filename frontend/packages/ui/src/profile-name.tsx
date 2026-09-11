import {Check, Pencil, X} from 'lucide-react'
import {useEffect, useId, useRef, useState} from 'react'
import {Button} from './button'
import {Input} from './components/input'

/** Displays a public profile identity and optionally edits the viewer's published contact name. */
export function ProfileName({
  publicName,
  petname,
  onSave,
}: {
  publicName: string
  petname?: string
  onSave?: (name: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(petname || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const pending = useRef(false)
  const editButton = useRef<HTMLButtonElement>(null)
  const descriptionId = useId()
  const wasEditing = useRef(false)
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus()
    wasEditing.current = editing
  }, [editing])
  const beginEditing = () => {
    if (!onSave) return
    setValue(petname || '')
    setError(false)
    setEditing(true)
  }
  const close = () => {
    setEditing(false)
  }
  const save = async () => {
    if (!onSave || pending.current) return
    pending.current = true
    setSaving(true)
    setError(false)
    try {
      await onSave(value.trim())
      close()
    } catch {
      setError(true)
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {editing ? (
        <>
          <div className="flex items-center gap-1" aria-busy={saving}>
            <Input
              autoFocus
              aria-label="Contact name"
              aria-describedby={descriptionId}
              value={value}
              placeholder={publicName}
              disabled={saving}
              onChangeText={setValue}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void save()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  close()
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Save contact name"
              disabled={saving}
              loading={saving}
              onClick={() => void save()}
            >
              <Check className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Cancel contact name"
              disabled={saving}
              onClick={close}
            >
              <X className="size-4" />
            </Button>
          </div>
          <p id={descriptionId} className="text-muted-foreground text-xs">
            Contact names are published, not private. Leave blank to use the public name.
          </p>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              Could not save contact name. Try again.
            </p>
          )}
        </>
      ) : (
        <div className="flex min-w-0 items-center gap-1">
          <h1 className="truncate text-2xl font-bold" onDoubleClick={beginEditing}>
            {petname || publicName}
          </h1>
          {onSave && (
            <Button
              ref={editButton}
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Edit contact name"
              onClick={beginEditing}
            >
              <Pencil className="size-4" />
            </Button>
          )}
        </div>
      )}
      {petname && petname !== publicName && <p className="text-muted-foreground truncate text-sm">{publicName}</p>}
    </div>
  )
}
