import type {HMQueryTableConfig} from '@seed-hypermedia/client/hm-types'
import type {ExploreView} from '@shm/shared/explore'
import {FileText, LayoutGrid, List, Table2} from 'lucide-react'
import {Button} from './button'
import {cn} from './utils'

const exploreViewOptions: Array<{value: ExploreView; label: string; icon: typeof FileText}> = [
  {value: 'list', label: 'List', icon: List},
  {value: 'card', label: 'Cards', icon: LayoutGrid},
  {value: 'table', label: 'Table', icon: Table2},
]

// Default table columns explorer opens with.
export function exploreTableConfig(showSpace: boolean): HMQueryTableConfig {
  const visible = new Set(showSpace ? ['title', 'space', 'updated'] : ['title', 'updated'])
  return {
    columns: ['title', 'space', 'updated', 'tags', 'children', 'comments', 'citations'].map((id) => ({
      id,
      visible: visible.has(id),
    })),
  }
}

// Explore view names map onto the Collections query block styles.
export function queryBlockStyle(view: ExploreView): 'Card' | 'List' | 'Table' {
  return view === 'card' ? 'Card' : view === 'table' ? 'Table' : 'List'
}

// Segmented view controls.
export function ExploreViewSwitcher({view, onChange}: {view: ExploreView; onChange: (view: ExploreView) => void}) {
  return (
    <div className="bg-muted flex items-center gap-0.5 rounded-md p-0.5">
      {exploreViewOptions.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant="ghost"
          aria-pressed={view === option.value}
          className={cn('h-7 gap-1.5 px-2', view === option.value && 'bg-background shadow-sm')}
          onClick={() => onChange(option.value)}
        >
          <option.icon className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">{option.label}</span>
        </Button>
      ))}
    </div>
  )
}
