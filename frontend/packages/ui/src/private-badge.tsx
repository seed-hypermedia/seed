import {Lock} from 'lucide-react'
import {Badge} from './components/badge'
import {cn} from './utils'

export function PrivateBadge({
  size = 'md',
  className,
}: {size?: 'sm' | 'md'; className?: string} = {}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-muted-foreground gap-0.5',
        size === 'sm' ? 'text-[10px]' : 'text-xs',
        className,
      )}
    >
      <Lock size={size === 'sm' ? 10 : 12} strokeWidth={2} />
      Private
    </Badge>
  )
}
