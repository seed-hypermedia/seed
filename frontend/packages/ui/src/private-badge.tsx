import {Lock} from 'lucide-react'
import {cn} from './utils'

export function PrivateBadge({size = 'md'}: {size?: 'sm' | 'md'} = {}) {
  const iconSize = size === 'sm' ? 10 : 12
  return (
    <div
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 font-medium text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300',
        size === 'sm' ? 'text-[10px]' : 'text-xs',
      )}
    >
      <Lock size={iconSize} strokeWidth={2} />
      Private
    </div>
  )
}
