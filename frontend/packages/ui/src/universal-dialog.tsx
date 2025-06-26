import {FC, useMemo, useState} from 'react'
import * as AlertDialog from './components/alert-dialog'
import * as Dialog from './components/dialog'
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogOverlay,
  DialogTitle,
} from './components/dialog'

export const AlertDialogContent = AlertDialog.AlertDialogContent

export const DialogCloseButton = Dialog.DialogClose

function getComponent(isAlert?: boolean) {
  const Component = isAlert
    ? {
        Root: AlertDialog.AlertDialog,
        Trigger: AlertDialog.AlertDialogTrigger,
        Portal: AlertDialog.AlertDialogPortal,
        Overlay: AlertDialog.AlertDialogOverlay,
        Content: AlertDialog.AlertDialogContent,
      }
    : {
        Root: Dialog.Dialog,
        Trigger: Dialog.DialogTrigger,
        Portal: Dialog.DialogPortal,
        Overlay: Dialog.DialogOverlay,
        Content: Dialog.DialogContent,
      }
  return Component
}

export function AppDialog<
  TriggerComponentProps extends {},
  ContentComponentProps extends {},
>({
  TriggerComponent,
  ContentComponent,
  isAlert,
  triggerLabel,
  triggerComponentProps,
  contentComponentProps,
}: {
  TriggerComponent: React.FC<
    {
      onPress?: (e: MouseEvent) => void
      children: React.ReactNode
    } & TriggerComponentProps
  >
  ContentComponent: React.FC<
    {onClose: () => void; isOpen: boolean} & ContentComponentProps
  >
  isAlert?: boolean
  triggerLabel?: string
  triggerComponentProps: TriggerComponentProps
  contentComponentProps: ContentComponentProps
}) {
  const Component = getComponent(isAlert)
  const [isOpen, setIsOpen] = useState(false)
  return (
    <Component.Root onOpenChange={setIsOpen} open={isOpen}>
      <Component.Trigger asChild>
        <TriggerComponent
          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation()
            setIsOpen(true)
          }}
          {...triggerComponentProps}
        >
          {triggerLabel}
        </TriggerComponent>
      </Component.Trigger>
      <Component.Portal>
        <Component.Overlay onClick={() => setIsOpen(false)} />
        <Component.Content>
          <ContentComponent
            isOpen={isOpen}
            onClose={() => {
              setIsOpen(false)
            }}
            {...contentComponentProps}
          />
        </Component.Content>
      </Component.Portal>
    </Component.Root>
  )
}

export function useAppDialog<DialogInput>(
  DialogContentComponent: FC<{
    onClose: () => void
    input: DialogInput
  }>,
  options?: {
    isAlert?: boolean
    onClose?: () => void
    contentClassName?: string
  },
) {
  const [openState, setOpenState] = useState<null | DialogInput>(null)

  const Component = getComponent(options?.isAlert)
  const onClose = options?.onClose
  return useMemo(() => {
    function open(input: DialogInput) {
      setOpenState(input)
    }

    function close() {
      setOpenState(null)
      onClose?.()
    }
    return {
      open,
      close,
      content: (
        <Component.Root
          modal
          onOpenChange={(isOpen) => {
            if (isOpen) throw new Error('Cannot open app dialog')
            close()
          }}
          open={!!openState}
        >
          <Component.Portal>
            <Component.Overlay />
            <Component.Content className={options?.contentClassName}>
              {openState && (
                <DialogContentComponent
                  input={openState}
                  onClose={() => {
                    setOpenState(null)
                    onClose?.()
                  }}
                />
              )}
            </Component.Content>
          </Component.Portal>
        </Component.Root>
      ),
    }
  }, [Component, DialogContentComponent, openState, onClose])
}
