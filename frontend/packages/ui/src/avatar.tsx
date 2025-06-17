import {useMemo} from 'react'
import {SizableText} from './text'
import {cn} from './utils'

export type UIAvatarProps = {
  url?: string
  size?: number
  color?: string
  label?: string
  id?: string
  onPress?: () => void
  className?: string
}

export function UIAvatar({
  url,
  id,
  label,
  size = 20,
  color,
  onPress,
  className,
}: UIAvatarProps) {
  let avatarColor = useMemo(() => {
    if (color) return color
    return id ? getRandomColor(id) : 'bg-gray-100'
  }, [id, color])

  let text = label ? label[0] : id ? id[0] : '?'

  return (
    <div
      className={cn(
        'z-1 relative flex items-center justify-center overflow-hidden',
        onPress && 'cursor-pointer',
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: url ? 'var(--color1)' : avatarColor,
      }}
      onClick={onPress}
    >
      {url ? (
        <img
          src={url}
          className="min-w-full min-h-full object-cover bg-[var(--color1)]"
          alt={label || id || 'Avatar'}
        />
      ) : (
        <SizableText
          weight="semibold"
          className="block text-center select-none text-black"
          style={{
            fontSize: size * 0.55,
            width: size / 2,
            height: size / 2,
            lineHeight: `${size / 2}px`,
          }}
        >
          {text.toUpperCase()}
        </SizableText>
      )}
    </div>
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
