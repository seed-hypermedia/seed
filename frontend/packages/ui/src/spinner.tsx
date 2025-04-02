// forked from tamagui because we cant import directly from tamagui package on web/remix

import type {ColorTokens, TamaguiElement, ThemeTokens} from '@tamagui/core'
import {themeable, useTheme, variableToString} from '@tamagui/core'
import type {YStackProps} from '@tamagui/stacks'
import {YStack} from '@tamagui/stacks'
import * as React from 'react'
import {useEffect, useState} from 'react'
import {ActivityIndicator} from 'react-native'
import {SizableText} from 'tamagui'

export type SpinnerProps = Omit<YStackProps, 'children'> & {
  size?: 'small' | 'large'
  color?: (ColorTokens | ThemeTokens | (string & {})) | null
}

export const Spinner: React.ForwardRefExoticComponent<
  SpinnerProps & React.RefAttributes<any>
> = YStack.styleable(
  themeable(
    React.forwardRef<TamaguiElement>((props: SpinnerProps, ref) => {
      const {size, color: colorProp, ...stackProps} = props
      const theme = useTheme()
      let color = colorProp as string
      if (color && color[0] === '$') {
        color = variableToString(theme[color])
      }
      return (
        <YStack ref={ref} {...stackProps}>
          <ActivityIndicator size={size} color={color} />
        </YStack>
      )
    }),
    {
      componentName: 'Spinner',
    },
  ),
) as any

export interface SpinnerWithTextProps {
  message: string
  delay?: number
}

export function SpinnerWithText({message, delay}: SpinnerWithTextProps) {
  const [displayMessage, setDisplayMessage] = useState('')

  useEffect(() => {
    if (!delay) {
      setDisplayMessage(message)
      return
    }

    const timer = setTimeout(() => {
      setDisplayMessage(message)
    }, delay)

    return () => clearTimeout(timer)
  }, [message, delay])

  return (
    <YStack fullscreen ai="center" jc="center" gap="$4" className="window-drag">
      <Spinner />
      <SizableText
        opacity={displayMessage ? 1 : 0}
        animation="slow"
        size="$5"
        color="$color9"
        fontWeight="300"
        textAlign="center"
        minHeight="$4"
      >
        {displayMessage}
      </SizableText>
    </YStack>
  )
}
