import * as DialogPrimitive from '@radix-ui/react-dialog'
import {Button} from '@shm/ui/button'
import {SizableText} from '@shm/ui/text'
import type {ComponentProps} from 'react'
import {H3} from 'tamagui'
import {DialogContent, DialogFooter, DialogOverlay} from './dialog'

function Root({children, ...props}: DialogPrimitive.DialogProps) {
  return (
    <DialogPrimitive.Root {...props}>
      <DialogOverlay />
      {children}
    </DialogPrimitive.Root>
  )
}

function Trigger(
  props: ComponentProps<typeof DialogPrimitive.Trigger> &
    ComponentProps<typeof Button>,
) {
  return (
    <DialogPrimitive.Trigger asChild>
      <Button {...props} />
    </DialogPrimitive.Trigger>
  )
}

function Title(props: any) {
  return (
    <DialogPrimitive.Title asChild>
      <H3 {...props} />
    </DialogPrimitive.Title>
  )
}

function Description(props: any) {
  return (
    <DialogPrimitive.Description asChild>
      <SizableText {...props} />
    </DialogPrimitive.Description>
  )
}

export const Prompt = {
  Root,
  Trigger,
  Content: DialogContent,
  Title,
  Description,
  Actions: DialogFooter,
  Close: DialogPrimitive.Close,
  Portal: DialogPrimitive.Portal,
}
