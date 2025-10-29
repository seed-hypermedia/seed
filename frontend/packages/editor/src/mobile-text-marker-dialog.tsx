import {Button} from '@shm/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@shm/ui/components/dialog'
import {Check, OrderedList, Quote, UnorderedList, X} from '@shm/ui/icons'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'

interface MobileTextMarkerDialogProps {
  isOpen: boolean
  onClose: () => void
  currentValue: string
  onChange: (value: string) => void
}

const textMarkerOptions = [
  {
    label: 'No Marker',
    value: 'Group',
    icon: <X className="h-5 w-5" />,
  },
  {
    label: 'Bullets',
    value: 'Unordered',
    icon: <UnorderedList className="h-5 w-5" />,
  },
  {
    label: 'Numbers',
    value: 'Ordered',
    icon: <OrderedList className="h-5 w-5" />,
  },
  {
    label: 'Block Quote',
    value: 'Blockquote',
    icon: <Quote className="h-5 w-5" />,
  },
]

export function MobileTextMarkerDialog({
  isOpen,
  onClose,
  currentValue,
  onChange,
}: MobileTextMarkerDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent
        className="h-full max-h-full w-full max-w-full rounded-none p-0"
        showCloseButton={false}
        onEscapeKeyDown={(e) => {
          e.preventDefault()
          onClose()
        }}
        onInteractOutside={(e) => {
          e.preventDefault()
          onClose()
        }}
      >
        <div className="flex h-full flex-col">
          <DialogHeader className="border-b p-4">
            <div className="flex items-center justify-between">
              <DialogTitle>Text Marker</DialogTitle>
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

          <div className="flex-1 overflow-y-auto">
            <div className="divide-y">
              {textMarkerOptions.map((option) => (
                <Button
                  key={option.value}
                  variant="ghost"
                  className={cn(
                    'h-auto w-full justify-start px-4 py-4',
                    currentValue === option.value && 'bg-muted',
                  )}
                  onClick={() => onChange(option.value)}
                >
                  <div className="flex w-full items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-md">
                        {option.icon}
                      </div>
                      <SizableText weight="medium">{option.label}</SizableText>
                    </div>
                    {currentValue === option.value && (
                      <Check size={20} color="currentColor" />
                    )}
                  </div>
                </Button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
