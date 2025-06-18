import {HTMLAttributes} from 'react'

export function OnlineIndicator({
  online,
  ...props
}: {online: boolean} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="flex items-center w-5 justify-center" {...props}>
      <div
        className={`w-2 h-2 rounded-full ${
          online
            ? 'bg-green-600 dark:bg-green-400'
            : 'bg-gray-400 dark:bg-gray-600'
        }`}
      />
    </div>
  )
}
