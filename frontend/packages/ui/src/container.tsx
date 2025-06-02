import {styled, View} from '@tamagui/core'
import {YStack} from '@tamagui/stacks'
import {ViewProps} from 'tamagui'
import {useIsDark} from './use-is-dark'
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

export const defaultContainerStyle = {
  w: 'calc(100% - 16px)',
  marginHorizontal: 8,
  borderColor: '$borderColor',
  borderWidth: 1,
  borderRadius: '$4',
}

export function PanelContainer({children, ...props}: ViewProps) {
  const isDark = useIsDark()

  return (
    <View
      h="100%"
      bg={isDark ? '$background' : '$backgroundStrong'}
      overflow="hidden"
      w="100%"
      $gtSm={defaultContainerStyle}
      {...props}
    >
      {children}
    </View>
  )
}

export const ContainerDefault = styled(YStack, {
  marginHorizontal: 'auto',
  paddingHorizontal: '$4',
  paddingVertical: '$6',
  width: '100%',
  $gtSm: {
    maxWidth: 700,
    paddingRight: '$2',
  },

  $gtMd: {
    maxWidth: 740,
    paddingRight: '$2',
  },

  $gtLg: {
    maxWidth: 800,
    paddingRight: '$10',
  },

  variants,
})

export const ContainerLarge = styled(YStack, {
  marginHorizontal: 'auto',
  paddingHorizontal: '$4',
  paddingTop: '$6',
  width: '100%',
  // maxWidth: "calc(85ch + 1em)",
  flexShrink: 'unset',
  variants,
})

export const ContainerXL = styled(YStack, {
  marginHorizontal: 'auto',
  paddingHorizontal: '$4',
  width: '100%',
  $gtSm: {
    maxWidth: 980,
  },

  $gtMd: {
    maxWidth: 1240,
  },

  $gtLg: {
    maxWidth: 1440,
  },

  variants,
})

export const AppContainer = ContainerLarge
export const Container = ContainerLarge

export const windowContainerStyles = cn(
  'flex flex-col w-screen h-screen min-h-svh bg-background dark:bg-black p-2',
)

export const panelContainerStyles = cn(
  'flex flex-col w-full h-full bg-background border border-border rounded-md overflow-hidden',
)
