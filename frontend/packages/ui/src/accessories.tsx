import {ChevronLeft} from 'lucide-react'
import {HTMLAttributes} from 'react'
import {Button} from './components/button'

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
      className={`justify-start px-2 py-0 text-muted-foreground rounded-lg ${
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
