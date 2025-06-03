import {HTMLAttributes, useMemo} from 'react'
import {Avatar, AvatarFallback, AvatarImage} from './components/avatar'
import {cn} from './utils'

export type UIAvatarProps = HTMLAttributes<HTMLDivElement> & {
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
  className,
  ...props
}: UIAvatarProps & {borderRadius?: number}) {
  let avatarColor = useMemo(() => {
    if (color) return color
    return id ? getRandomColor(id) : 'transparent'
  }, [id, color])

  let text = label ? label[0] : id ? id[0] : '?'

  return (
    <Avatar
      className={cn(
        'avatar relative flex items-center justify-center overflow-hidden',
        onPress && 'cursor-pointer hover:cursor-default',
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: borderRadius,
        backgroundColor: url ? undefined : avatarColor,
      }}
      onClick={onPress}
      {...props}
    >
      {url ? (
        <AvatarImage
          src={url}
          alt={label || id || 'Avatar'}
          className="min-w-full min-h-full object-cover bg-transparent"
        />
      ) : null}
      <AvatarFallback
        delayMs={500}
        className="flex items-center justify-center text-black select-none"
        style={{
          fontSize: size * 0.55,
          width: size / 2,
          height: size / 2,
          lineHeight: `${size / 2}px`,
          backgroundColor: avatarColor,
        }}
      >
        {text.toUpperCase()}
      </AvatarFallback>
    </Avatar>
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
