import {Button} from '@shm/ui/button'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {Check} from 'lucide-react'
import {BlockNoteEditor, BlockSchema} from './blocknote'

export const TOOLBAR_COLOR_NAMES = [
  'default',
  'gray',
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
] as const

export type ToolbarColorName = (typeof TOOLBAR_COLOR_NAMES)[number]

const TEXT_SWATCHES: Record<ToolbarColorName, string> = {
  default: '#37352f',
  gray: '#9b9a97',
  brown: '#64473a',
  red: '#e03e3e',
  orange: '#d9730d',
  yellow: '#dfab01',
  green: '#4d6461',
  blue: '#0b6e99',
  purple: '#6940a5',
  pink: '#ad1a72',
}

const HIGHLIGHT_SWATCHES: Record<ToolbarColorName, string> = {
  default: 'transparent',
  gray: '#ebeced',
  brown: '#e9e5e3',
  red: '#fbe4e4',
  orange: '#faebdd',
  yellow: '#fbf3db',
  green: '#ddedea',
  blue: '#ddebf1',
  purple: '#eae4f2',
  pink: '#f4dfeb',
}

function applyColorStyle<BSchema extends BlockSchema>(
  editor: BlockNoteEditor<BSchema>,
  style: 'textColor' | 'backgroundColor',
  color: ToolbarColorName,
) {
  if (color === 'default') {
    editor.removeStyles({[style]: true} as any)
  } else {
    editor.addStyles({[style]: color} as any)
  }
}

export function TextColorPalette<BSchema extends BlockSchema>({
  editor,
  current,
  onSelect,
}: {
  editor: BlockNoteEditor<BSchema>
  current: ToolbarColorName
  onSelect?: () => void
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="text-color-palette">
      <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Text color</div>
      <div className="grid grid-cols-5 gap-2">
        {TOOLBAR_COLOR_NAMES.map((name) => (
          <Tooltip key={name} content={name === 'default' ? 'Default' : name.charAt(0).toUpperCase() + name.slice(1)}>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              data-testid={`text-color-${name}`}
              className={cn(
                'border-border h-7 w-7 rounded-full border p-0 hover:opacity-80',
                current === name && 'ring-foreground ring-2 ring-offset-1',
              )}
              style={{backgroundColor: TEXT_SWATCHES[name]}}
              onClick={() => {
                applyColorStyle(editor, 'textColor', name)
                onSelect?.()
              }}
            >
              {current === name ? (
                <Check className="size-3.5 text-white mix-blend-difference" />
              ) : (
                <span className="sr-only">{name}</span>
              )}
            </Button>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}

export function HighlightPalette<BSchema extends BlockSchema>({
  editor,
  current,
  onSelect,
}: {
  editor: BlockNoteEditor<BSchema>
  current: ToolbarColorName
  onSelect?: () => void
}) {
  return (
    <div className="flex flex-col gap-1" data-testid="highlight-palette">
      <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Highlight</div>
      <div className="flex flex-col gap-1">
        {TOOLBAR_COLOR_NAMES.map((name) => {
          // Every named swatch uses a light pastel fill, so its label must
          // render in dark text regardless of the app theme — `text-foreground`
          // would resolve to white in dark mode and disappear into the pastel
          // background. Only the `default` row (no fill) follows the theme.
          const isDefault = name === 'default'
          return (
            <button
              type="button"
              key={name}
              data-testid={`highlight-${name}`}
              className={cn(
                'border-border focus:ring-foreground flex items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm transition-colors focus:ring-2 focus:outline-none',
                current === name && 'ring-foreground ring-2',
                isDefault ? 'text-foreground' : 'text-neutral-700',
              )}
              style={{backgroundColor: HIGHLIGHT_SWATCHES[name]}}
              onClick={() => {
                applyColorStyle(editor, 'backgroundColor', name)
                onSelect?.()
              }}
            >
              <span className="font-mono text-xs underline">A</span>
              <span className="text-xs capitalize">{isDefault ? 'No highlight' : name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
