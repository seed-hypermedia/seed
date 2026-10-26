import {Expand} from 'lucide-react'
import {enableZoom} from 'pele/lazy'
import {useEffect, useRef, useState, type MouseEventHandler} from 'react'
import {createPortal} from 'react-dom'
import {Button} from './button'
import {Dialog, DialogContent, DialogTitle, DialogTrigger} from './components/dialog'
import {cn} from './utils'
import './diagram.css'

type DiagramViewProps = {
  svg: string
  className?: string
  expandButtonContainer?: HTMLElement | null
  onClick?: MouseEventHandler<HTMLDivElement>
  onAuxClick?: MouseEventHandler<HTMLDivElement>
}

/** Shows a diagram with an accessible expanded zoom and pan dialog. */
export function DiagramView({svg, className, expandButtonContainer, onClick, onAuxClick}: DiagramViewProps) {
  const [open, setOpen] = useState(false)
  const preview = useRef<HTMLDivElement>(null)
  const [previewHeight, setPreviewHeight] = useState<number>()
  const expandButton = (
    <DialogTrigger asChild>
      <Button
        type="button"
        size={expandButtonContainer ? 'iconSm' : 'icon'}
        variant={expandButtonContainer ? 'ghost' : 'outline'}
        className={
          expandButtonContainer
            ? 'text-muted-foreground bg-background'
            : 'bg-background absolute top-2 right-2 shadow-sm'
        }
        aria-label="Expand diagram"
        title="Expand diagram"
        onClick={(event) => event.stopPropagation()}
      >
        <Expand className={expandButtonContainer ? 'size-3.5' : 'size-4'} />
      </Button>
    </DialogTrigger>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setPreviewHeight(preview.current?.getBoundingClientRect().height)
        setOpen(nextOpen)
      }}
    >
      <div
        ref={preview}
        className={cn('relative min-w-0', className)}
        style={open ? {height: previewHeight} : undefined}
        contentEditable={false}
      >
        {!open && (
          <div
            className="flex w-full justify-center overflow-auto [&_svg]:max-w-full"
            onClick={onClick}
            onAuxClick={onAuxClick}
            dangerouslySetInnerHTML={{__html: svg}}
          />
        )}
        {expandButtonContainer ? createPortal(expandButton, expandButtonContainer) : expandButton}
      </div>
      {open && (
        <DialogContent
          className="h-9/10 w-11/12 max-w-7xl rounded-xl border motion-reduce:animate-none"
          contentClassName="gap-0 overflow-hidden p-0"
          aria-describedby={undefined}
          contentEditable={false}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
          }}
        >
          <DialogTitle className="border-b px-4 py-3 text-sm font-medium">Diagram</DialogTitle>
          <ExpandedDiagram svg={svg} onClick={onClick} onAuxClick={onAuxClick} />
        </DialogContent>
      )}
    </Dialog>
  )
}

function ExpandedDiagram({svg, onClick, onAuxClick}: DiagramViewProps) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const diagram = element.querySelector('svg')
    if (diagram) {
      diagram.style.width = 'auto'
      diagram.style.maxHeight = '100%'
    }
    const zoom = enableZoom(element, {always: true})
    element.focus()
    return () => zoom.destroy()
  }, [svg])

  return (
    <div
      ref={container}
      className="hm-mermaid relative m-4 flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      tabIndex={0}
      aria-label="Diagram. Use plus and minus to zoom, arrow keys to pan, and zero to reset."
      onClick={onClick}
      onAuxClick={onAuxClick}
      dangerouslySetInnerHTML={{__html: svg}}
    />
  )
}
