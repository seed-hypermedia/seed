import {Button} from '@shm/ui/button'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {HeadingIcon, OrderedList, Quote, Type, UnorderedList} from '@shm/ui/icons'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {cn} from '@shm/ui/utils'
import {Check} from 'lucide-react'
import {ReactNode} from 'react'
import {BlockNoteEditor, BlockSchema} from './blocknote'
import {ToolbarColorName} from './toolbar-color-palette'

export type StyleOptionsPanelProps<BSchema extends BlockSchema> = {
  editor: BlockNoteEditor<BSchema>
  currentBlockType: string
  currentGroupType: string
  currentColumnCount: string
  currentTextColor: ToolbarColorName
  currentBackgroundColor: ToolbarColorName
  onBlockTypeChange: (value: string) => void
  onGroupTypeChange: (value: string) => void
  onColumnCountChange: (value: string) => void
}

const COLUMN_OPTIONS: {label: string; value: string}[] = [
  {label: '1 column', value: '1'},
  {label: '2 columns', value: '2'},
  {label: '3 columns', value: '3'},
]

export function StyleOptionsPanel<BSchema extends BlockSchema>(props: StyleOptionsPanelProps<BSchema>) {
  const {
    editor,
    currentBlockType,
    currentGroupType,
    currentColumnCount,
    currentTextColor,
    currentBackgroundColor,
    onBlockTypeChange,
    onGroupTypeChange,
    onColumnCountChange,
  } = props

  return (
    <div className="grid grid-cols-2 gap-4" data-testid="style-options-panel">
      <div className="flex flex-col gap-3">
        <Section title="Text">
          <PanelItem
            testId="block-type-heading"
            icon={<HeadingIcon className="size-4" />}
            label="Heading"
            active={currentBlockType === 'heading'}
            onClick={() => onBlockTypeChange(currentBlockType === 'heading' ? 'paragraph' : 'heading')}
          />
          <PanelItem
            testId="block-type-paragraph"
            icon={<Type className="size-4" />}
            label="Paragraph"
            active={currentBlockType === 'paragraph' && currentGroupType !== 'Blockquote'}
            onClick={() => onBlockTypeChange('paragraph')}
          />
          <PanelItem
            testId="group-type-blockquote"
            icon={<Quote className="size-4" />}
            label="Quote"
            active={currentGroupType === 'Blockquote'}
            onClick={() => onGroupTypeChange(currentGroupType === 'Blockquote' ? 'Group' : 'Blockquote')}
          />
          {/* <ColorPaletteItem
            testId="text-color-trigger"
            icon={<Palette className="size-4" />}
            label="Color"
            active={currentTextColor !== 'default'}
          >
            {({close}) => <TextColorPalette editor={editor} current={currentTextColor} onSelect={close} />}
          </ColorPaletteItem>
          <ColorPaletteItem
            testId="highlight-trigger"
            icon={<Highlighter className="size-4" />}
            label="Highlight"
            active={currentBackgroundColor !== 'default'}
          >
            {({close}) => <HighlightPalette editor={editor} current={currentBackgroundColor} onSelect={close} />}
          </ColorPaletteItem> */}
        </Section>
      </div>

      <div className="flex flex-col gap-3">
        <Section title="List">
          <PanelItem
            testId="group-type-unordered"
            icon={<UnorderedList className="size-4" />}
            label="Bullet points"
            active={currentGroupType === 'Unordered'}
            onClick={() => onGroupTypeChange(currentGroupType === 'Unordered' ? 'Group' : 'Unordered')}
          />
          <PanelItem
            testId="group-type-ordered"
            icon={<OrderedList className="size-4" />}
            label="Numbered list"
            active={currentGroupType === 'Ordered'}
            onClick={() => onGroupTypeChange(currentGroupType === 'Ordered' ? 'Group' : 'Ordered')}
          />
        </Section>

        <Section title="Grid">
          {COLUMN_OPTIONS.map((opt) => {
            const isGrid = currentGroupType === 'Grid'
            const active = isGrid && currentColumnCount === opt.value
            return (
              <PanelItem
                key={opt.value}
                testId={`grid-cols-${opt.value}`}
                icon={<GridIcon count={Number(opt.value)} />}
                label={opt.label}
                active={active}
                onClick={() => {
                  if (!isGrid) onGroupTypeChange('Grid')
                  onColumnCountChange(opt.value)
                }}
              />
            )
          })}
        </Section>
      </div>
    </div>
  )
}

function Section({title, children}: {title: string; children: ReactNode}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  )
}

function PanelItem({
  icon,
  label,
  active,
  onClick,
  testId,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  onClick?: () => void
  testId?: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      data-testid={testId}
      className={cn(
        'h-9 w-full justify-start gap-2 rounded-md border border-black/10 bg-transparent px-3 text-sm font-normal dark:border-white/10',
        'hover:bg-black/5 dark:hover:bg-white/10',
        active && 'bg-black/5 dark:bg-white/10',
      )}
      onClick={onClick}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      {active && <Check className="size-4 text-green-600 dark:text-green-400" />}
    </Button>
  )
}

function ColorPaletteItem({
  icon,
  label,
  active,
  testId,
  children,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  testId?: string
  children: (api: {close: () => void}) => ReactNode
}) {
  const popover = usePopoverState()
  return (
    <Popover {...popover}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          data-testid={testId}
          className={cn(
            'h-9 w-full justify-start gap-2 rounded-md border border-black/10 bg-transparent px-3 text-sm font-normal dark:border-white/10',
            'hover:bg-black/5 dark:hover:bg-white/10',
            active && 'bg-black/5 dark:bg-white/10',
          )}
        >
          <span className="text-muted-foreground">{icon}</span>
          <span className="flex-1 truncate text-left">{label}</span>
          {active && <Check className="size-4 text-green-600 dark:text-green-400" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        collisionPadding={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="w-auto p-3"
      >
        {children({close: () => popover.onOpenChange(false)})}
      </PopoverContent>
    </Popover>
  )
}

function GridIcon({count}: {count: number}) {
  return (
    <span className="border-muted-foreground/60 flex h-4 w-4 items-center gap-[1px] rounded-sm border p-[1px]">
      {Array.from({length: count}, (_, i) => (
        <span key={i} className="bg-muted-foreground/60 h-full flex-1 rounded-[1px]" />
      ))}
    </span>
  )
}
