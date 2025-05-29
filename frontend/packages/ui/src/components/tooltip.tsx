import {
  Tooltip as TheTooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui/tooltip'

export function Tooltip({
  content,
  side = 'top',
  ...props
}: React.ComponentProps<typeof TheTooltip> & {
  content: string
  side?: React.ComponentProps<typeof TooltipContent>['side']
}) {
  return (
    <TheTooltip {...props}>
      <TooltipTrigger asChild>{props.children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </TheTooltip>
  )
}
