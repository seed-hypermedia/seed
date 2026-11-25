import {ArrowLeft, Maximize, X} from 'lucide-react'
import {Button} from './button'
import {Text} from './text'

/** Shared 48px title row for desktop panels and mobile drawers. */
export function PanelHeader({
  title,
  titleId,
  count,
  onBack,
  onExpand,
  onClose,
}: {
  title: string
  titleId?: string
  count?: number
  onBack?: () => void
  onExpand?: () => void
  onClose?: () => void
}) {
  return (
    <div className="bg-card border-border box-border flex h-12 shrink-0 items-center gap-2 border-b px-4 md:px-5">
      {onBack && (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-full"
          aria-label="Back to comments"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </Button>
      )}
      <Text id={titleId} weight="semibold" size="lg" className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate">{title}</span>
        {count !== undefined && (
          <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs font-medium">
            {count}
          </span>
        )}
      </Text>
      <div className="flex shrink-0 items-center gap-1">
        {onExpand && (
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label={`Expand ${title.toLowerCase()}`}
            title={`Expand ${title.toLowerCase()}`}
            onClick={onExpand}
          >
            <Maximize className="size-4" />
          </Button>
        )}
        {onClose && (
          <Button variant="ghost" size="icon" className="rounded-full" aria-label="Close panel" onClick={onClose}>
            <X className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
