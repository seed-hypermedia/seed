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
    <div
      className="bg-background dark:bg-gray-700 rounded-sm"
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
      {...props}
    />
  )
}
