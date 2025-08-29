import {ChevronLeft} from 'lucide-react'
import {HTMLAttributes} from 'react'
import {Button} from './button'
import {ScrollArea} from './components/scroll-area'
import {cn} from './utils'

export function AccessoryBackButton({
  onClick,
  label,
  className,
  ...props
}: {
  onClick: React.ComponentProps<'button'>['onClick']
  label?: string
} & HTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'text-muted-foreground m-2 flex-1 justify-start rounded-lg p-2',
        className,
      )}
      onClick={onClick}
      {...props}
    >
      <ChevronLeft size={16} />
      {label || 'Back'}
    </Button>
  )
}

export function AccessoryContent({
  children,
  footer,
  header,
  title,
  ...props
}: {
  children?: React.ReactNode
  footer?: React.ReactNode
  header?: React.ReactNode
  title?: string
  className?: string
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden" {...props}>
      <ScrollArea>
        {header ? (
          <div className="border-border max-h-1/2 border-b p-4">{header}</div>
        ) : null}
        <div className={cn('flex flex-col gap-2')}>{children}</div>
      </ScrollArea>
      {footer ? (
        <div className="border-border bg-background m-2 max-h-1/2 rounded-md border py-2 dark:bg-black">
          <ScrollArea>{footer}</ScrollArea>
        </div>
      ) : null}
    </div>
  )
}
