import * as jdenticon from 'jdenticon'
import {memo, useEffect, useRef} from 'react'
import {SizableText} from './text'
import {cn} from './utils'

jdenticon.configure({
  hues: [151],
  lightness: {
    color: [0.35, 0.5],
    grayscale: [0.55, 0.55],
  },
  saturation: {
    color: 0.54,
    grayscale: 0.5,
  },
  backColor: '#0000',
})

/**
 * This component generates an arbitrary but deterministic SVG icon based on the given value.
 * Useful as a placeholder for users without avatars.
 * It's much better than a generic avatar because users without names, or with the same name could be distinguished,
 * as the identicon is based on their ID.
 */
const Identicon = memo((props: {value: string; size: number}) => {
  const icon = useRef(null)

  useEffect(() => {
    if (icon.current) {
      jdenticon.update(icon.current, props.value)
    }
  }, [props.value, props.size])

  return (
    <svg
      data-jdenticon-value={props.value}
      height={props.size}
      width={props.size}
      ref={icon}
      {...props}
    />
  )
})

export type UIAvatarProps = {
  size?: number
  label?: string
  onPress?: () => void
  className?: string
} & (
  | {url: string; id: string} // At least url or id must be provided, but both are fine too.
  | {url?: string; id: string}
  | {url: string; id?: string}
)

export function UIAvatar({
  url,
  id,
  label,
  size = 20,
  onPress,
  className,
}: UIAvatarProps) {
  let text = label ? label[0] : id ? id[0] : '?'

  return (
    <div
      className={cn(
        'relative z-1 flex items-center justify-center overflow-hidden',
        onPress && 'cursor-pointer',
        !url && 'ring-px ring-border ring',
        className,
      )}
      style={{
        width: size,
        height: size,
      }}
      onClick={onPress}
    >
      {id && !url ? (
        <Identicon value={id} size={size} />
      ) : url ? (
        <img
          src={url}
          className="min-h-full min-w-full bg-[var(--color1)] object-cover"
          alt={label || id || 'Account Avatar'}
        />
      ) : (
        <SizableText
          weight="semibold"
          className="block text-center text-black select-none"
          style={{
            fontSize: size * 0.55,
            width: size / 2,
            height: size / 2,
            lineHeight: `${size / 2}px`,
          }}
        >
          {text?.toUpperCase() || '?'}
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
