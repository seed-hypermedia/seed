import {ComponentProps} from 'react'
import {Popover} from './TamaguiPopover'
import {dialogBoxShadow} from './universal-dialog'

export function HoverCard({
  children,
  content,
  contentProps,
  disabled = false,
  placement = 'bottom-start',
}: {
  children: React.ReactNode
  content: React.ReactNode
  contentProps?: React.ComponentProps<typeof Popover.Content>
  placement?: ComponentProps<typeof Popover>['placement']
  disabled?: boolean
}) {
  if (!content) return children
  return (
    <Popover
      hoverable
      placement={placement}
      open={disabled ? false : undefined}
    >
      <Popover.Trigger
        className="no-window-drag"
        height="100%"
        alignSelf="stretch"
        flex={1}
      >
        {children}
      </Popover.Trigger>
      <Popover.Content
        boxShadow={dialogBoxShadow}
        gap="$2"
        padding="$2"
        ai="flex-start"
        {...contentProps}
      >
        {content}
      </Popover.Content>
    </Popover>
  )
}
