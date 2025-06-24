// @ts-nocheck
import {SizableText} from '@shm/ui/text'
import * as React from 'react'
import {HTMLAttributes} from 'react'
import {cn} from './utils'

export function PanelCard({
  title,
  content,
  author,
  date,
  onPress,
  avatar,
  active = false,
  shorter = false,
  ...props
}: {
  title?: string
  content?: string
  author?: any
  date?: any
  onPress?: () => void
  avatar?: React.ReactNode | null
  active?: boolean
  shorter?: boolean
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'hover:bg-muted m-4 flex cursor-pointer flex-col gap-2 overflow-hidden rounded-lg p-4 transition-colors duration-200',
        active ? 'bg-muted' : 'bg-transparent',
        shorter ? 'py-1' : 'py-4',
      )}
      onClick={onPress}
      {...props}
    >
      {/* <div
        className="absolute w-0.5 bg-gray-300 dark:bg-gray-700"
        style={{
          height: isFirst || isLast ? '50%' : '100%',
          top: isFirst ? '50%' : 0,
          left: (avatarSize - 2) / 2
        }}
      /> */}
      <div className="flex items-center gap-2">
        {avatar}
        {author && (
          <SizableText size="sm">{author.profile?.alias || '...'}</SizableText>
        )}
        <div className="flex flex-1" />
        {date && (
          <SizableText size="sm" color="muted" className="px-1">
            {date}
          </SizableText>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {title && (
          <SizableText
            weight="semibold"
            className="truncate overflow-hidden whitespace-nowrap"
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
      </div>
    </div>
  )
}
