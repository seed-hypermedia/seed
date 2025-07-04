import {HTMLAttributes} from 'react'

export function OnlineIndicator({
  online,
  ...props
}: {online: boolean} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="flex w-4 items-center justify-center" {...props}>
      <div
        className={`size-2 rounded-full ${
          online
            ? 'bg-green-600 dark:bg-green-400'
            : 'bg-gray-400 dark:bg-gray-600'
        }`}
      />
    </div>
  )
}
