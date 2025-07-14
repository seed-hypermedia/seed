import * as AlertDialog from '@shm/ui/components/alert-dialog'
import * as Dialog from '@shm/ui/components/dialog'
import {FC, useMemo, useState} from 'react'
import {GestureResponderEvent} from 'react-native'
export {AlertDialogContent} from '@shm/ui/components/alert-dialog'
export {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogOverlay,
  DialogTitle,
} from '@shm/ui/components/dialog'

import {
  NavContextProvider,
  NavigationContext,
  useNavigation,
} from '../utils/navigation'

export const dialogBoxShadow =
  'hsl(206 22% 7% / 35%) 0px 10px 38px -10px, hsl(206 22% 7% / 20%) 0px 10px 20px -15px'

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
      onPress?: (e: GestureResponderEvent) => void
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
  const nav = useNavigation(undefined)
  return (
    <Component.Root onOpenChange={setIsOpen} open={isOpen}>
      <Component.Trigger asChild>
        <TriggerComponent
          onPress={(e) => {
            e.stopPropagation()
            setIsOpen(true)
          }}
          {...triggerComponentProps}
        >
          {triggerLabel}
        </TriggerComponent>
      </Component.Trigger>
      <Component.Portal>
        <NavContextProvider value={nav}>
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
        </NavContextProvider>
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
    overrideNavigation?: NavigationContext
  },
) {
  const [openState, setOpenState] = useState<null | DialogInput>(null)
  const nav = useNavigation(options?.overrideNavigation)

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
          onOpenChange={(isOpen: boolean) => {
            if (isOpen) throw new Error('Cannot open app dialog')
            close()
          }}
          open={!!openState}
        >
          <Component.Portal>
            <NavContextProvider value={nav}>
              <Component.Overlay onClick={close} />
              <Component.Content>
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
            </NavContextProvider>
          </Component.Portal>
        </Component.Root>
      ),
    }
  }, [Component, DialogContentComponent, nav, openState, onClose])
}
