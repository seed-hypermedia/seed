import {Button} from '@shm/ui/button'
import {X} from 'lucide-react'
import {FC, HTMLAttributes, useMemo, useState} from 'react'
import {GestureResponderEvent} from 'react-native'
import {AlertDialog, Dialog, Unspaced} from 'tamagui'
import {
  NavContextProvider,
  NavigationContext,
  useNavigation,
} from '../utils/navigation'

export function DialogOverlay(props: any) {
  // for somer reason this is required for the overlay to go behind the DialogContent. maybe because of the DialogContent position:fixed below
  return (
    <Dialog.Overlay
      zIndex="$zIndex.8"
      animation="medium"
      enterStyle={{opacity: 0}}
      exitStyle={{opacity: 0}}
      {...props}
    />
  )
}

export const dialogBoxShadow =
  'hsl(206 22% 7% / 35%) 0px 10px 38px -10px, hsl(206 22% 7% / 20%) 0px 10px 20px -15px'

export function DialogContent(props: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className="bg-background z-[900] flex flex-col gap-4 rounded-md border-0 p-4"
      style={{
        backgroundColor: 'var(--background)',
        boxShadow: dialogBoxShadow,
        width: '90vw',
        maxWidth: '500px',
        maxHeight: '85vh',
      }}
      {...props}
    />
  )
}

export function AlertDialogContent(props: any) {
  return <AlertDialog.Content borderWidth={0} {...props} />
}

export function DialogFooter(props: HTMLAttributes<HTMLDivElement>) {
  return <div className="flex justify-end gap-4" {...props} />
}
export function DialogTitle(props: any) {
  return <Dialog.Title className="text-lg font-bold" {...props} />
}

export function DialogCloseButton() {
  return (
    <Unspaced>
      <Dialog.Close asChild>
        <Button
          size="sm"
          variant="ghost"
          className="absolute top-3 right-3 rounded-full"
        >
          <X className="size-4" />
        </Button>
      </Dialog.Close>
    </Unspaced>
  )
}

export const DialogDescription = Dialog.Description

function getComponent(isAlert?: boolean) {
  const Component = isAlert
    ? {
        Root: AlertDialog,
        Trigger: AlertDialog.Trigger,
        Portal: AlertDialog.Portal,
        Overlay: AlertDialog.Overlay,
        Content: AlertDialogContent,
      }
    : {
        Root: Dialog,
        Trigger: Dialog.Trigger,
        Portal: Dialog.Portal,
        Overlay: DialogOverlay,
        Content: DialogContent,
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
          <Component.Overlay
            height="100vh"
            bg={'#00000088'}
            width="100vw"
            animation="fast"
            opacity={0.8}
            enterStyle={{opacity: 0}}
            exitStyle={{opacity: 0}}
            onPress={() => setIsOpen(false)}
          />
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
              <Component.Overlay
                height="100vh"
                bg={'#00000088'}
                width="100vw"
                animation="fast"
                opacity={0.8}
                enterStyle={{opacity: 0}}
                exitStyle={{opacity: 0}}
                onPress={close}
              />
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
