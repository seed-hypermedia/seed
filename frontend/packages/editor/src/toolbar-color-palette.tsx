import {Button} from '@shm/ui/button'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {Check} from 'lucide-react'
import {BlockNoteEditor, BlockSchema} from './blocknote'

export const TOOLBAR_COLOR_NAMES = [
  'default',
  'red',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'fuchsia',
  'pink',
] as const

export type ToolbarColorName = (typeof TOOLBAR_COLOR_NAMES)[number]

export const TEXT_SWATCH_CLASS: Record<Exclude<ToolbarColorName, 'default'>, string> = {
  red: 'bg-red-700 dark:bg-red-400',
  amber: 'bg-amber-700 dark:bg-amber-400',
  yellow: 'bg-yellow-700 dark:bg-yellow-400',
  lime: 'bg-lime-700 dark:bg-lime-400',
  green: 'bg-green-700 dark:bg-green-400',
  emerald: 'bg-emerald-700 dark:bg-emerald-400',
  teal: 'bg-teal-700 dark:bg-teal-400',
  cyan: 'bg-cyan-700 dark:bg-cyan-400',
  sky: 'bg-sky-700 dark:bg-sky-400',
  blue: 'bg-blue-700 dark:bg-blue-400',
  indigo: 'bg-indigo-700 dark:bg-indigo-400',
  violet: 'bg-violet-700 dark:bg-violet-400',
  fuchsia: 'bg-fuchsia-700 dark:bg-fuchsia-400',
  pink: 'bg-pink-700 dark:bg-pink-400',
}

const HIGHLIGHT_SWATCH_CLASS: Record<Exclude<ToolbarColorName, 'default'>, string> = {
  red: 'bg-red-100 dark:bg-red-900/40',
  amber: 'bg-amber-100 dark:bg-amber-900/40',
  yellow: 'bg-yellow-100 dark:bg-yellow-900/40',
  lime: 'bg-lime-100 dark:bg-lime-900/40',
  green: 'bg-green-100 dark:bg-green-900/40',
  emerald: 'bg-emerald-100 dark:bg-emerald-900/40',
  teal: 'bg-teal-100 dark:bg-teal-900/40',
  cyan: 'bg-cyan-100 dark:bg-cyan-900/40',
  sky: 'bg-sky-100 dark:bg-sky-900/40',
  blue: 'bg-blue-100 dark:bg-blue-900/40',
  indigo: 'bg-indigo-100 dark:bg-indigo-900/40',
  violet: 'bg-violet-100 dark:bg-violet-900/40',
  fuchsia: 'bg-fuchsia-100 dark:bg-fuchsia-900/40',
  pink: 'bg-pink-100 dark:bg-pink-900/40',
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

function colorLabel(name: ToolbarColorName): string {
  if (name === 'default') return 'Default'
  return name.charAt(0).toUpperCase() + name.slice(1)
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
        {TOOLBAR_COLOR_NAMES.map((name) => {
          const isDefault = name === 'default'
          return (
            <Tooltip key={name} content={colorLabel(name)} contentClassName="z-[10001]">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                data-testid={`text-color-${name}`}
                className={cn(
                  'h-7 w-7 rounded-full border border-black/10 p-0 hover:opacity-80 dark:border-white/10',
                  isDefault ? 'bg-background' : TEXT_SWATCH_CLASS[name],
                  current === name && 'ring-foreground ring-2 ring-offset-1',
                )}
                onClick={() => {
                  applyColorStyle(editor, 'textColor', name)
                  onSelect?.()
                }}
              >
                {current === name ? (
                  <Check
                    className={cn('size-3.5', isDefault ? 'text-foreground' : 'text-white mix-blend-difference')}
                  />
                ) : (
                  <span className="sr-only">{name}</span>
                )}
              </Button>
            </Tooltip>
          )
        })}
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
          const isDefault = name === 'default'
          return (
            <Tooltip key={name} content={colorLabel(name)} contentClassName="z-[10001]" asChild>
              <button
                type="button"
                data-testid={`highlight-${name}`}
                className={cn(
                  'focus:ring-foreground flex items-center gap-2 rounded-md border border-black/10 px-3 py-1.5 text-left text-sm transition-colors focus:ring-2 focus:outline-none dark:border-white/10',
                  isDefault ? 'bg-background text-foreground' : HIGHLIGHT_SWATCH_CLASS[name],
                  !isDefault && 'dark:text-foreground text-neutral-800',
                  current === name && 'ring-foreground ring-2',
                )}
                onClick={() => {
                  applyColorStyle(editor, 'backgroundColor', name)
                  onSelect?.()
                }}
              >
                <span className="font-mono text-xs underline">A</span>
                {isDefault && <span className="text-xs">No highlight</span>}
              </button>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
