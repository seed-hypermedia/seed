import {
  ComponentProps,
  PropsWithChildren,
  ReactNode,
  useMemo,
  useState,
} from 'react'
import {Button} from './components/button'
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
        'select-none cursor-default border rounded-lg overflow-hidden',
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
        'flex items-center py-2 px-4 bg-gray-200 dark:bg-gray-800 gap-3',
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
        'flex items-start w-full p-4',
        isDark ? 'bg-black' : 'bg-gray-50',
        'hover:bg-gray-100 dark:hover:bg-gray-900',
        'border-b border-gray-200 dark:border-gray-700 last:border-b-0',
        className,
      )}
      {...props}
    >
      <div className="flex items-start w-full">{children}</div>
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
      <div className="flex-1 flex items-center justify-end">{right}</div>
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
        className="flex-none min-w-[140px] w-[140px] text-muted-foreground"
      >
        {label}:
      </SizableText>
      <div className="flex-1 min-w-0 overflow-hidden">
        {values.map((value, index) => (
          <SizableText
            key={index}
            size="xs"
            className="block w-full overflow-hidden text-ellipsis whitespace-nowrap select-text font-mono"
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
              'ml-2 transition-opacity flex-none',
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
              'ml-2 transition-opacity flex-none',
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
