import {HTMLAttributes, ReactNode, TdHTMLAttributes} from 'react'
import {cn} from './utils'

const Root = ({className, ...props}: HTMLAttributes<HTMLTableElement>) => (
  <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
    <table
      className={cn('w-full border-collapse select-none', className)}
      {...props}
    />
  </div>
)

const THead = ({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) => (
  <thead
    className={cn(
      'bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700',
      className,
    )}
    {...props}
  />
)

const TBody = ({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody
    className={cn(
      '[&>tr:nth-child(odd)]:bg-gray-50/50 dark:[&>tr:nth-child(odd)]:bg-gray-800/30',
      className,
    )}
    {...props}
  />
)

const TFoot = ({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) => (
  <tfoot
    className={cn(
      'bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 font-medium',
      className,
    )}
    {...props}
  />
)

const Row = ({className, ...props}: HTMLAttributes<HTMLTableRowElement>) => (
  <tr
    className={cn(
      'border-b border-gray-100 dark:border-gray-800 last:border-0',
      'hover:bg-gray-100/80 dark:hover:bg-gray-700/50',
      'transition-colors duration-150 ease-in-out',
      className,
    )}
    {...props}
  />
)

const Cell = ({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td
    className={cn(
      'text-sm text-gray-900 dark:text-gray-100',
      'transition-colors duration-150 ease-in-out',
      className,
    )}
    {...props}
  />
)

const HCell = ({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td
    className={cn(
      'text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider',
      'transition-colors duration-150 ease-in-out',
      className,
    )}
    {...props}
  />
)

interface CellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  children: ReactNode
  noPadding?: boolean
}

export const DataTable = {
  Root,
  Body: TBody,
  Head: THead,
  HeaderCell: ({
    children,
    noPadding = false,
    colSpan = 1,
    className,
    ...props
  }: CellProps) => (
    <HCell colSpan={colSpan} className={className} {...props}>
      <div
        className={cn(
          'px-6 first:pl-6 last:pr-6',
          noPadding ? 'py-0' : colSpan > 1 ? 'py-2' : 'py-3',
          'flex items-center gap-2',
        )}
      >
        {children}
      </div>
    </HCell>
  ),
  Footer: TFoot,
  Row,
  Cell: ({
    children,
    noPadding = false,
    colSpan = 1,
    className,
    ...props
  }: CellProps) => (
    <Cell colSpan={colSpan} className={className} {...props}>
      <div
        className={cn(
          'px-6 first:pl-6 last:pr-6',
          noPadding ? 'py-0' : colSpan > 1 ? 'py-2' : 'py-4',
          'flex items-center gap-2 min-h-[3rem]',
        )}
      >
        {children}
      </div>
    </Cell>
  ),
}
