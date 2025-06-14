import {XStack, XStackProps} from '@tamagui/stacks'
import {useMemo} from 'react'
import {SizableText} from './text'

export type UIAvatarProps = XStackProps & {
  url?: string
  size?: number
  color?: string
  label?: string
  id?: string
  onPress?: () => void
}

export function UIAvatar({
  url,
  id,
  label,
  size = 20,
  color,
  onPress,
  borderRadius = size,
}: UIAvatarProps & {borderRadius?: XStackProps['borderRadius']}) {
  let avatarColor = useMemo(() => {
    if (color) return color
    return id ? getRandomColor(id) : 'transparent'
  }, [id, color])

  let text = label ? label[0] : id ? id[0] : '?'

  return (
    <XStack
      className="avatar"
      width={size}
      height={size}
      borderRadius={borderRadius}
      overflow="hidden"
      backgroundColor={url ? '$color1' : avatarColor}
      alignItems="center"
      justifyContent="center"
      position="relative"
      onPress={onPress}
      hoverStyle={{
        cursor: onPress ? 'default' : undefined,
      }}
    >
      {url ? (
        <img
          src={url}
          style={{
            minWidth: '100%',
            minHeight: '100%',
            objectFit: 'cover',
            backgroundColor: 'transparent',
          }}
        />
      ) : (
        <SizableText
          weight="semibold"
          className="block text-center select-none"
          style={{
            fontSize: size * 0.55,
            width: size / 2,
            height: size / 2,
            lineHeight: `${size / 2}px`,
            color: 'black',
          }}
        >
          {text.toUpperCase()}
        </SizableText>
      )}
    </XStack>
  )
}

export function getRandomColor(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 6) - hash)
    hash = hash & hash // Convert to 32bit integer
  }
  const shortened = hash % 360
  return `hsl(${shortened},60%,80%)`
}
