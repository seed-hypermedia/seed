import {ChevronLeft} from 'lucide-react'
import {HTMLAttributes} from 'react'
import {Button} from './button'

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
      className={`text-muted-foreground justify-start rounded-lg px-2 py-0 ${
        className || ''
      }`}
      onClick={onPress}
      {...props}
    >
      <ChevronLeft size={16} />
      {label || 'Back'}
    </Button>
  )
}
