// @ts-nocheck
import {SizableText} from '@shm/ui/text'
import * as React from 'react'
import {XStack, YStack} from 'tamagui'

export function PanelCard({
  title,
  content,
  author,
  date,
  onPress,
  avatar,
  active = false,
  shorter = false,
}: {
  title?: string
  content?: string
  author?: any
  date?: any
  onPress?: () => void
  avatar?: React.ReactNode | null
  active?: boolean
  shorter?: boolean
}) {
  return (
    <YStack
      overflow="hidden"
      borderRadius="$2"
      backgroundColor={active ? '$backgroundHover' : '$backgroundTransparent'}
      hoverStyle={{
        backgroundColor: '$backgroundHover',
      }}
      margin="$4"
      padding="$4"
      paddingVertical={shorter ? '$1' : '$4'}
      gap="$2"
      onPress={onPress}
    >
      {/* <YStack
        position="absolute"
        width={2}
        height={isFirst || isLast ? '50%' : '100%'}
        top={isFirst ? '50%' : 0}
        left={(avatarSize - 2) / 2}
        backgroundColor="$color5"
      /> */}
      <XStack
        gap="$2"
        ai="center"
        // borderColor="$color5" borderWidth={1}
      >
        {avatar}
        {author && (
          <SizableText size="sm">{author.profile?.alias || '...'}</SizableText>
        )}
        <XStack flex={1} />
        {date && (
          <SizableText size="sm" color="muted" className="px-1">
            {date}
          </SizableText>
        )}
      </XStack>
      <YStack gap="$2" flex={1}>
        {title && (
          <SizableText
            weight="semibold"
            className="truncate whitespace-nowrap overflow-hidden"
          >
            {title}
          </SizableText>
        )}
        {content && (
          <SizableText
            color="muted"
            size="xs"
            className="overflow-hidden leading-6"
            style={{maxHeight: 23 * 3}}
          >
            {content}
          </SizableText>
        )}
      </YStack>
    </YStack>
  )
}
