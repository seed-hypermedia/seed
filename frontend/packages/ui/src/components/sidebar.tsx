import {Slot} from '@radix-ui/react-slot'
import * as React from 'react'

import {cn} from '../utils'

function SidebarHeader({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
}

function SidebarContent({className, ...props}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-auto', className)}
      {...props}
    />
  )
}

function SidebarFooter({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-footer" className={cn('flex flex-col gap-2 p-2', className)} {...props} />
}

function SidebarSeparator({className, ...props}: React.ComponentProps<'hr'>) {
  return (
    <hr data-slot="sidebar-separator" className={cn('bg-sidebar-border mx-2 h-px border-none', className)} {...props} />
  )
}

function SidebarGroup({className, ...props}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group"
      className={cn('relative flex w-full min-w-0 flex-col gap-2', className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({className, ...props}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        'text-sidebar-foreground/70 flex items-center gap-1 px-3 text-xs font-semibold tracking-wide uppercase select-none',
        className,
      )}
      {...props}
    />
  )
}

function SidebarGroupAction({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & {asChild?: boolean}) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="sidebar-group-action"
      className={cn(
        'text-sidebar-foreground/70 hover:text-sidebar-foreground flex aspect-square w-5 items-center justify-center rounded-md',
        className,
      )}
      {...props}
    />
  )
}

function SidebarGroupContent({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group-content" className={cn('w-full text-sm', className)} {...props} />
}

function SidebarMenu({className, ...props}: React.ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu" className={cn('flex w-full min-w-0 flex-col gap-1', className)} {...props} />
}

function SidebarMenuItem({className, ...props}: React.ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" className={cn('group/menu-item relative', className)} {...props} />
}

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  className,
  ...props
}: React.ComponentProps<'button'> & {
  asChild?: boolean
  isActive?: boolean
}) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="sidebar-menu-button"
      data-active={isActive}
      className={cn(
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none',
        className,
      )}
      {...props}
    />
  )
}

function SidebarMenuAction({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & {asChild?: boolean}) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="sidebar-menu-action"
      className={cn(
        'text-sidebar-foreground/70 hover:text-sidebar-foreground absolute top-1/2 right-1 flex -translate-y-1/2 items-center justify-center rounded-md p-1',
        className,
      )}
      {...props}
    />
  )
}

function SidebarMenuBadge({className, ...props}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      className={cn('text-sidebar-foreground/70 ml-auto text-xs font-medium tabular-nums', className)}
      {...props}
    />
  )
}

export {
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarSeparator,
}
