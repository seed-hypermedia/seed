import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@shm/ui/components/alert-dialog'
import {cn} from '@shm/ui/utils'
import type {ComponentProps, PropsWithChildren} from 'react'
import React from 'react'

function Root({children, ...props}: ComponentProps<typeof AlertDialog>) {
  return <AlertDialog {...props}>{children}</AlertDialog>
}

function Title({className, ...props}: ComponentProps<typeof AlertDialogTitle>) {
  return (
    <AlertDialogTitle
      className={cn('text-lg font-semibold', className)}
      {...props}
    />
  )
}

function Description({
  className,
  ...props
}: ComponentProps<typeof AlertDialogDescription>) {
  return (
    <AlertDialogDescription
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  )
}

function Cancel({
  disabled = false,
  className,
  ...props
}: PropsWithChildren<
  ComponentProps<typeof AlertDialogCancel> & {
    disabled?: boolean
    className?: string
  }
>) {
  return (
    <AlertDialogCancel
      className={cn('mt-2 sm:mt-0', className)}
      disabled={disabled}
      {...props}
    />
  )
}

function Action({
  disabled = false,
  className,
  ...props
}: PropsWithChildren<
  ComponentProps<typeof AlertDialogAction> & {
    disabled?: boolean
    className?: string
    onClick: React.MouseEventHandler<HTMLButtonElement>
  }
>) {
  return (
    <AlertDialogAction className={className} disabled={disabled} {...props} />
  )
}

export const Alert = {
  Root,
  Trigger: AlertDialogTrigger,
  Content: AlertDialogContent,
  Title,
  Description,
  Cancel,
  Action,
}
