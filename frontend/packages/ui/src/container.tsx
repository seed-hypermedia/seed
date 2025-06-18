import {styled} from '@tamagui/core'
import {YStack} from '@tamagui/stacks'
import {cn} from './utils'

const variants = {
  hide: {
    true: {
      pointerEvents: 'none',
      opacity: 0,
    },
  },
  clearVerticalSpace: {
    true: {
      paddingVertical: 0,
    },
  },
  centered: {
    true: {
      maxWidth: 'calc(85ch + 1em)',
    },
  },
} as const

export function PanelContainer({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="w-full h-full px-2">
      <div
        className={cn(
          'h-full bg-white dark:bg-background sm:border sm:border-border sm:rounded-md overflow-hidden',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  )
}

export const Container = styled(YStack, {
  marginHorizontal: 'auto',
  paddingHorizontal: '$4',
  paddingTop: '$6',
  width: '100%',
  // maxWidth: "calc(85ch + 1em)",
  flexShrink: 'unset',
  variants,
})

export const windowContainerStyles = cn(
  'flex flex-col w-screen h-screen min-h-svh bg-background dark:bg-black p-2',
)

export const panelContainerStyles = cn(
  'flex flex-col w-full h-full bg-background dark:bg-black border border-border rounded-md overflow-hidden bg-white dark:bg-background',
)
