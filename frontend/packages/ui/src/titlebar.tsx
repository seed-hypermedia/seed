// @ts-nocheck
import {ButtonText} from 'tamagui'
import {SizableText} from './text'
import {cn} from './utils'

export const TitlebarWrapper = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'border-border m-0 flex min-h-[40px] w-full flex-none flex-col items-stretch justify-center border-0 border-b border-solid bg-transparent px-0 py-0',
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

export const TitleText = (props) => (
  <SizableText
    name="TitlebarH1"
    size="sm"
    className="text-foreground m-0 max-w-full cursor-default overflow-hidden rounded-sm font-bold text-ellipsis whitespace-nowrap"
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
}: React.ComponentProps<typeof ButtonText>) => (
  <ButtonText
    className={cn(
      'text-foreground m-0 flex-shrink-0 cursor-default overflow-hidden p-0 text-base font-bold text-ellipsis whitespace-nowrap normal-case select-none hover:underline hover:decoration-current',
      className,
    )}
    {...props}
  >
    {children}
  </ButtonText>
)
