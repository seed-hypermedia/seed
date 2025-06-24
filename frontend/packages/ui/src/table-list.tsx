import {
  ComponentProps,
  PropsWithChildren,
  ReactNode,
  useMemo,
  useState,
} from 'react'
import {Button} from './button'
import {Copy, ExternalLink} from './icons'
import {SizableText} from './text'
import {Tooltip} from './tooltip'
import {useIsDark} from './use-is-dark'
import {cn} from './utils'

function useHover() {
  const [hover, setHover] = useState(false)

  return useMemo(
    () => ({
      hover,
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
    }),
    [hover],
  )
}

TableList.Header = TableHeader
TableList.Item = TableItem

export function TableList({
  children,
  className,
  ...props
}: {
  children: ReactNode
  className?: string
} & ComponentProps<'div'>) {
  const isDark = useIsDark()
  return (
    <div
      className={cn(
        'cursor-default overflow-hidden rounded-lg border select-none',
        isDark ? 'border-gray-700 bg-black' : 'border-gray-200 bg-gray-50',
        'sm:mx-0',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function TableHeader({
  children,
  className,
  ...props
}: PropsWithChildren<{className?: string} & ComponentProps<'div'>>) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 bg-gray-200 px-4 py-2 dark:bg-gray-800',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function TableItem({
  children,
  className,
  ...props
}: PropsWithChildren<{className?: string} & ComponentProps<'div'>>) {
  const isDark = useIsDark()
  return (
    <div
      className={cn(
        'flex w-full items-start p-4',
        isDark ? 'bg-black' : 'bg-gray-50',
        'hover:bg-gray-100 dark:hover:bg-gray-900',
        'border-b border-gray-200 last:border-b-0 dark:border-gray-700',
        className,
      )}
      {...props}
    >
      <div className="flex w-full items-start">{children}</div>
    </div>
  )
}

export function InfoListHeader({
  title,
  right,
}: {
  title: string
  right?: ReactNode
}) {
  return (
    <TableList.Header>
      <SizableText weight="bold">{title}</SizableText>
      <div className="flex flex-1 items-center justify-end">{right}</div>
    </TableList.Header>
  )
}

export function InfoListItem({
  label,
  value,
  onCopy,
  onOpen,
}: {
  label: string
  value?: string | string[]
  onCopy?: () => void
  onOpen?: () => void
}) {
  const values = Array.isArray(value) ? value : [value]
  const {hover, ...hoverProps} = useHover()

  return (
    <TableList.Item {...hoverProps}>
      <SizableText
        size="xs"
        className="text-muted-foreground w-[140px] min-w-[140px] flex-none"
      >
        {label}:
      </SizableText>
      <div className="min-w-0 flex-1 overflow-hidden">
        {values.map((value, index) => (
          <SizableText
            key={index}
            size="xs"
            className="block w-full overflow-hidden font-mono text-ellipsis whitespace-nowrap select-text"
          >
            {value}
          </SizableText>
        ))}
      </div>
      {!!value && onCopy ? (
        <Tooltip content={`Copy ${label}`}>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'ml-2 flex-none transition-opacity',
              hover ? 'opacity-100' : 'opacity-0',
            )}
            onClick={onCopy}
          >
            <Copy />
          </Button>
        </Tooltip>
      ) : null}
      {!!value && onOpen ? (
        <Tooltip content={`Open ${label}`}>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'ml-2 flex-none transition-opacity',
              hover ? 'opacity-100' : 'opacity-0',
            )}
            onClick={onOpen}
          >
            <ExternalLink />
          </Button>
        </Tooltip>
      ) : null}
    </TableList.Item>
  )
}
