import {ChevronLeft} from 'lucide-react'
import {HTMLAttributes} from 'react'
import {Button} from './button'
import {ScrollArea} from './components/scroll-area'
import {cn} from './utils'

export function SelectionBackButton({
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

export function PanelContent({
  children,
  header,
}: {
  children: React.ReactNode
  header?: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      {header ? (
        <div className="border-border border-b p-4">{header}</div>
      ) : null}
      <ScrollArea className="">{children}</ScrollArea>
    </div>
  )
}

export function SelectionContent({
  children,
  footer,
  header,
  bottomPadding,
  centered,
  ...props
}: {
  children?: React.ReactNode
  footer?: React.ReactNode
  header?: React.ReactNode
  bottomPadding?: number | string
  centered?: boolean
}) {
  const content = (
    <div
      className={cn('flex flex-col gap-2')}
      style={{paddingBottom: bottomPadding}}
    >
      {children}
    </div>
  )

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden" {...props}>
      {header ? (
        <div
          className={cn(
            'border-border max-h-1/2 border-b p-4',
            centered && 'mx-auto w-full max-w-[calc(85ch+1em)]',
          )}
        >
          {header}
        </div>
      ) : null}
      {centered ? (
        <div className="mx-auto w-full max-w-[calc(85ch+1em)] px-4">
          {content}
        </div>
      ) : (
        content
      )}
      {footer ? (
        <div className="border-border bg-background m-2 max-h-1/2 rounded-md border py-2 dark:bg-black">
          {footer}
        </div>
      ) : null}
    </div>
  )
}
