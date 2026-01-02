import {Eye, X} from 'lucide-react'
import {Button} from './button'

export function PreviewBanner({onClose}: {onClose?: () => void}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 dark:border-amber-700 dark:bg-amber-900/50">
      <div className="flex items-center gap-2">
        <Eye className="size-4 text-amber-700 dark:text-amber-300" />
        <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
          Preview Mode - This is how your document will look when published
        </span>
      </div>
      {onClose ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-7 px-2 text-amber-800 hover:bg-amber-200 hover:text-amber-900 dark:text-amber-200 dark:hover:bg-amber-800 dark:hover:text-amber-100"
        >
          <X className="size-4" />
          <span className="ml-1">Close</span>
        </Button>
      ) : null}
    </div>
  )
}
