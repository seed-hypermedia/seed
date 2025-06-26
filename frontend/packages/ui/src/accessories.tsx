import {ChevronLeft} from 'lucide-react'
import {HTMLAttributes} from 'react'
import {Button} from './button'
import {cn} from './utils'

export function AccessoryBackButton({
  onPress,
  label,
  className,
  ...props
}: {
  onPress: () => void
  label?: string
} & HTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'text-muted-foreground flex-1 justify-start rounded-lg p-2',
        className,
      )}
      onClick={onPress}
      {...props}
    >
      <ChevronLeft size={16} />
      {label || 'Back'}
    </Button>
  )
}
