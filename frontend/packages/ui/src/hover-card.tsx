import {Popover} from './TamaguiPopover'
import {dialogBoxShadow} from './universal-dialog'

export function HoverCard({
  children,
  content,
}: {
  children: React.ReactNode
  content: React.ReactNode
}) {
  return (
    <Popover hoverable placement="bottom-start">
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
      >
        {content}
      </Popover.Content>
    </Popover>
  )
}
