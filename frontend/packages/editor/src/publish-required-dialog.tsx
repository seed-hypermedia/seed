import {Button} from '@shm/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shm/ui/components/dialog'

/**
 * Shown when a user tries to copy a block link or comment on a block in an
 * unpublished draft.
 */
export type PublishRequiredDialogIntent = 'copy-link' | 'comment'

const COPY: Record<PublishRequiredDialogIntent, {title: string; description: string}> = {
  'copy-link': {
    title: 'Publish to share a link',
    description: 'You need to publish this document before you can share a link to a block in it.',
  },
  comment: {
    title: 'Publish to comment',
    description: 'You need to publish this document before others can leave comments on its blocks.',
  },
}

export function PublishRequiredDialog({
  open,
  onOpenChange,
  intent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  intent: PublishRequiredDialogIntent
}) {
  const copy = COPY[intent]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="publish-required-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle data-testid="publish-required-dialog-title">{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="default"
            data-testid="publish-required-dialog-dismiss"
            onClick={() => onOpenChange(false)}
          >
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
