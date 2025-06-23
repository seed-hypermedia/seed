import {Skeleton} from '@shm/ui/components/skeleton'
import {HTMLAttributes} from 'react'

export const Placeholder = ({
  width = '100%',
  height = 16,
  ...props
}: {
  width?: string | number
  height?: string | number
} & HTMLAttributes<HTMLDivElement>) => {
  return (
    <Skeleton
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
      {...props}
    />
  )
}
