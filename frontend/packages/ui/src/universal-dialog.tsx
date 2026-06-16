import {NavContextProvider, NavigationContext, useNavigation} from '@shm/shared/utils/navigation'
import * as React from 'react'
import {FC, useMemo, useState} from 'react'

import {ButtonProps} from './button'
import * as AlertDialog from './components/alert-dialog'
import * as Dialog from './components/dialog'

export const dialogBoxShadow = 'hsl(206 22% 7% / 35%) 0px 10px 38px -10px, hsl(206 22% 7% / 20%) 0px 10px 20px -15px'

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

export function AppDialog<TriggerComponentProps extends {}, ContentComponentProps extends {}>({
  TriggerComponent,
  ContentComponent,
  isAlert,
  triggerLabel,
  triggerComponentProps,
  contentComponentProps,
}: {
  TriggerComponent: React.FC<
    {
      onClick: ButtonProps['onClick']
      children: React.ReactNode
    } & TriggerComponentProps
  >
  ContentComponent: React.FC<{onClose: () => void; isOpen: boolean} & ContentComponentProps>
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
          onClick={(e) => {
            e.stopPropagation()
            setIsOpen(true)
          }}
          {...triggerComponentProps}
        >
          {triggerLabel}
        </TriggerComponent>
      </Component.Trigger>
      <Component.Portal>
        {/* Stop React synthetic events from bubbling through portal to parent components */}
        <div onClick={(e) => e.stopPropagation()}>
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
        </div>
      </Component.Portal>
    </Component.Root>
  )
}

export function useAppDialog<DialogInput>(
  DialogContentComponent: FC<{
    onClose: () => void
    input: DialogInput
    setDialogCloseProtection?: (state: {preventClose: boolean; showCloseButton: boolean}) => void
  }>,
  options?: {
    isAlert?: boolean
    onClose?: () => void
    className?: string // Dialog container styles (size, position, etc.)
    contentClassName?: string // Inner content wrapper styles (padding, layout, etc.)
    showCloseButton?: boolean | ((input: DialogInput) => boolean)
    preventClose?: boolean | ((input: DialogInput) => boolean)
    overrideNavigation?: NavigationContext
  },
) {
  const [openState, setOpenState] = useState<null | DialogInput>(null)
  const [closeProtection, setCloseProtection] = useState<null | {preventClose: boolean; showCloseButton: boolean}>(null)
  const nav = useNavigation(options?.overrideNavigation)

  const Component = getComponent(options?.isAlert)
  const onClose = options?.onClose
  return useMemo(() => {
    function open(input: DialogInput) {
      setCloseProtection(null)
      setOpenState(input)
    }

    function close() {
      setCloseProtection(null)
      setOpenState(null)
      onClose?.()
    }

    const optionClosePrevented =
      typeof options?.preventClose === 'function'
        ? openState
          ? options.preventClose(openState)
          : false
        : !!options?.preventClose
    const optionShowCloseButton =
      typeof options?.showCloseButton === 'function'
        ? openState
          ? options.showCloseButton(openState)
          : true
        : options?.showCloseButton
    const isClosePrevented = closeProtection?.preventClose ?? optionClosePrevented
    const showCloseButton = closeProtection?.showCloseButton ?? optionShowCloseButton

    return {
      open,
      close,
      content: (
        <Component.Root
          modal
          onOpenChange={(isOpen: boolean) => {
            if (isOpen) throw new Error('Cannot open app dialog')
            if (isClosePrevented) return
            close()
          }}
          open={!!openState}
        >
          <Component.Portal>
            {/* Stop React synthetic events from bubbling through portal to parent components */}
            <div onClick={(e) => e.stopPropagation()}>
              <NavContextProvider value={nav}>
                <Component.Overlay onClick={isClosePrevented ? undefined : close} />
                <Component.Content
                  className={options?.className}
                  contentClassName={options?.contentClassName}
                  showCloseButton={showCloseButton}
                >
                  {openState && (
                    <DialogContentComponent
                      input={openState}
                      setDialogCloseProtection={setCloseProtection}
                      onClose={() => {
                        setCloseProtection(null)
                        setOpenState(null)
                        onClose?.()
                      }}
                    />
                  )}
                </Component.Content>
              </NavContextProvider>
            </div>
          </Component.Portal>
        </Component.Root>
      ),
    }
  }, [
    Component,
    DialogContentComponent,
    nav,
    openState,
    onClose,
    options?.className,
    options?.contentClassName,
    options?.showCloseButton,
    options?.preventClose,
    closeProtection,
  ])
}
