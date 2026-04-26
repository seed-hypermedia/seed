import {Button} from '@shm/ui/button'

export function ParentUpdateToast({message, onViewParent}: {message: string; onViewParent: () => void}) {
  return (
    <div className="flex items-center gap-2">
      <span>{message}</span>
      <Button size="xs" variant="link" className="h-auto p-0" onClick={onViewParent}>
        View parent
      </Button>
    </div>
  )
}
