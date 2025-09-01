// @ts-nocheck
import * as React from 'react'
import {SizableText} from './text'
import {cn} from './utils'

export const TitlebarWrapper = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'm-0 flex min-h-[40px] w-full flex-none flex-col items-stretch justify-center bg-transparent px-0 py-0',
      className,
    )}
    {...props}
  >
    {children}
  </div>
)

export const TitlebarRow = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'window-drag flex flex-none flex-shrink-0 flex-grow-0 pr-2',
      className,
    )}
    {...props}
  >
    {children}
  </div>
)

export const TitlebarSection = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'no-window-drag flex items-center gap-2 select-none',
      className,
    )}
    {...props}
  >
    {children}
  </div>
)

const titleTextClasses =
  'text-foreground m-0 max-w-full cursor-default w-full rounded-sm text-sm font-bold truncate whitespace-nowrap normal-case select-none hover:underline hover:decoration-current truncate'

export const TitleText = (props) => (
  <SizableText
    name="TitlebarH1"
    size="sm"
    className={titleTextClasses}
    {...props}
  />
)

//   whiteSpace: 'nowrap',
//   maxWidth: '100%',
//   overflow: 'hidden',
//   textOverflow: 'ellipsis',
//   name: 'TitlebarH1',
//   color: '$color12',
//   fontSize: '$4',
//   userSelect: 'none',
//   cursor: 'default',
//   margin: 0,
//   textTransform: 'none',
//   padding: '$1',
//   borderRadius: '$1',
// })

export const TitleTextButton = ({
  className,
  children,
  ...props
}: React.ComponentProps<'button'>) => (
  <button className={cn(titleTextClasses, className)} {...props}>
    {children}
  </button>
)
