import {cn} from '@shm/ui/utils'
import React, {ReactNode} from 'react'

export function TitlebarMainRow({
  sidebarLocked,
  sidebarWidth,
  sidebarControl,
  navigation,
  omnibar,
  actions,
  className,
}: {
  sidebarLocked: boolean
  sidebarWidth?: string
  sidebarControl: ReactNode
  navigation: ReactNode
  omnibar: ReactNode
  actions: ReactNode
  className?: string
}) {
  return (
    <div className={cn('window-drag flex w-full min-w-0 items-center pr-2', className)} data-titlebar-layout>
      <div
        className={cn(
          'window-drag flex shrink-0 items-center',
          sidebarLocked ? 'justify-end pr-2' : 'justify-start pl-2',
        )}
        style={sidebarLocked && sidebarWidth ? {width: sidebarWidth} : undefined}
        data-titlebar-sidebar-region
      >
        {sidebarControl}
      </div>
      <div className="window-drag flex min-w-0 flex-1 items-center" data-titlebar-main-region>
        <div className="window-drag flex shrink-0 items-center" data-titlebar-navigation-region>
          {navigation}
        </div>
        <div className="flex min-w-0 flex-1 items-center overflow-hidden px-2" data-titlebar-omnibar-region>
          {omnibar}
        </div>
      </div>
      <div
        className="window-drag flex min-w-0 shrink-0 items-center justify-end overflow-hidden"
        data-titlebar-actions-region
      >
        {actions}
      </div>
    </div>
  )
}
