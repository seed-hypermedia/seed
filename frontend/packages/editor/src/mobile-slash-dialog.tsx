import {Button} from '@shm/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@shm/ui/components/dialog'
import {X} from '@shm/ui/icons'
import {SizableText} from '@shm/ui/text'
import {BlockNoteEditor} from './blocknote/core'
import {HMBlockSchema} from './schema'
import {getSlashMenuItems} from './slash-menu-items'

interface MobileSlashDialogProps {
  isOpen: boolean
  onClose: () => void
  editor: BlockNoteEditor<HMBlockSchema>
}

export function MobileSlashDialog({
  isOpen,
  onClose,
  editor,
}: MobileSlashDialogProps) {
  const slashMenuItems = getSlashMenuItems()

  const handleSelectBlockType = (item: any) => {
    item.execute(editor)
    onClose()

    setTimeout(() => {
      editor._tiptapEditor.commands.focus()
    }, 100)
  }

  const groupedItems = slashMenuItems.reduce(
    (acc, item) => {
      const group = item.group || 'Other'
      if (!acc[group]) acc[group] = []
      acc[group].push(item)
      return acc
    },
    {} as Record<string, typeof slashMenuItems>,
  )

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="h-full max-h-full w-full max-w-full rounded-none p-0"
        showCloseButton={false}
      >
        <div className="flex h-full flex-col">
          <DialogHeader className="border-b p-4">
            <div className="flex items-center justify-between">
              <DialogTitle>Insert Block</DialogTitle>
              <Button
                size="icon"
                variant="ghost"
                onClick={onClose}
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>

          {/* Block Types List */}
          <div className="flex-1 overflow-y-auto">
            {Object.entries(groupedItems).map(([groupName, items]) => (
              <div key={groupName} className="py-2">
                {groupName && (
                  <SizableText
                    size="xs"
                    weight="medium"
                    className="text-muted-foreground px-4 py-2"
                  >
                    {groupName}
                  </SizableText>
                )}
                <div className="divide-y">
                  {items.map((item) => (
                    <Button
                      key={item.name}
                      variant="ghost"
                      className="h-auto w-full justify-start px-4 py-4"
                      onClick={() => handleSelectBlockType(item)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-md">
                          {item.icon}
                        </div>
                        <div className="flex flex-col items-start">
                          <SizableText weight="medium">{item.name}</SizableText>
                          {item.hint && (
                            <SizableText
                              size="sm"
                              className="text-muted-foreground"
                            >
                              {item.hint}
                            </SizableText>
                          )}
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
