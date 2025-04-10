import {styled, View} from '@tamagui/core'
import {YStack} from '@tamagui/stacks'
import {ComponentProps, useMemo} from 'react'
import {useThemeName} from 'tamagui'

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

export function PanelContainer({
  children,
  ...props
}: ComponentProps<typeof YStack>) {
  const themeName = useThemeName()
  const isDark = useMemo(() => themeName === 'dark', [themeName])

  return (
    <View
      className="page-container"
      h="100%"
      bg={isDark ? '$background' : '$backgroundStrong'}
      overflow="hidden"
      w="100%"
      $gtSm={{
        w: 'calc(100% - 16px)',
        marginHorizontal: 8,
        borderColor: '$borderColor',
        borderWidth: 1,
        borderRadius: '$4',
      }}
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
