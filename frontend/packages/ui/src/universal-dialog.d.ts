import {NavigationContext} from '@shm/shared/utils/navigation'
import * as React from 'react'
import {FC} from 'react'
import {ButtonProps} from '@shm/ui/button'
export declare const dialogBoxShadow =
  'hsl(206 22% 7% / 35%) 0px 10px 38px -10px, hsl(206 22% 7% / 20%) 0px 10px 20px -15px'
export declare function AppDialog<
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
      onClick: ButtonProps['onClick']
      children: React.ReactNode
    } & TriggerComponentProps
  >
  ContentComponent: React.FC<
    {
      onClose: () => void
      isOpen: boolean
    } & ContentComponentProps
  >
  isAlert?: boolean
  triggerLabel?: string
  triggerComponentProps: TriggerComponentProps
  contentComponentProps: ContentComponentProps
}): import('react/jsx-runtime').JSX.Element
export declare function useAppDialog<DialogInput>(
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
): {
  open: (input: DialogInput) => void
  close: () => void
  content: import('react/jsx-runtime').JSX.Element
}
