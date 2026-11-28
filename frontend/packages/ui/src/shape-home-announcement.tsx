import {Home, PanelLeft, PanelTop} from 'lucide-react'

import {Button} from './button'
import {DialogDescription, DialogTitle} from './components/dialog'

// TODO: replace with the Shape my Home help document
/** Help document URL for the "Learn more" link in the Shape Home announcement. */
export const LEARN_MORE_URL = 'hm://z6MkfzKMhF9k1oPaQsShWAg8xJzbWf5kaZgn1MkeZvhcAsmB/build/sidebar-navigation'

const PLACEHOLDER_TITLES = ['About', 'Projects', 'Blog']

/** Props for the Shape Home announcement modal body. */
export interface ShapeHomeAnnouncementProps {
  /** Up to 3 candidate page titles to show as branches under Home. Empty array → placeholder examples. */
  candidateTitles: string[]
  /** Called when the user clicks "Learn more". */
  onLearnMore: () => void
  /** Called when the user clicks "Not now". */
  onNotNow: () => void
  /** Called when the user clicks "Shape my Home". */
  onShapeHome: () => void
}

/** Modal body announcing the sidebar-navigation change and offering to shape the user's Home. */
export function ShapeHomeAnnouncement({
  candidateTitles,
  onLearnMore,
  onNotNow,
  onShapeHome,
}: ShapeHomeAnnouncementProps) {
  return (
    <div className="flex flex-col gap-5">
      <span className="bg-brand/10 text-brand w-fit rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wide uppercase">
        New in Seed
      </span>
      <div className="flex flex-col gap-1.5">
        <DialogTitle className="text-2xl leading-tight font-bold">We changed how Seed organises spaces</DialogTitle>
        <DialogDescription>
          This change affects how your content is arranged: nothing is lost, we just need to reorganise it.
        </DialogDescription>
      </div>

      <TreeIllustration titles={candidateTitles} />

      <div className="bg-muted flex flex-col gap-3 rounded-lg p-4">
        <InfoRow icon={<PanelLeft className="text-brand size-4" />}>
          <strong>Document browser (left):</strong> Shows your navigation tree: Home and everything you add to it.
        </InfoRow>
        <InfoRow icon={<PanelTop className="text-brand size-4" />}>
          <strong>Header (top):</strong> Quick links to what readers visit most. Yours stay as they are.
        </InfoRow>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">We’ll help you shape your Home as you go.</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="link" onClick={onLearnMore} className="w-full sm:w-auto">
            Learn more
          </Button>
          <Button variant="outline" onClick={onNotNow} className="w-full sm:w-auto">
            Not now
          </Button>
          <Button variant="default" autoFocus onClick={onShapeHome} className="w-full sm:w-auto">
            Shape my Home
          </Button>
        </div>
      </div>
    </div>
  )
}

function TreeIllustration({titles}: {titles: string[]}) {
  const chips = renderChips(titles)
  return (
    <div className="flex items-start gap-4">
      <div className="flex flex-col gap-2">
        <div className="bg-brand flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold text-white">
          <Home className="size-3.5" aria-hidden />
          <span>Home</span>
        </div>
        <ul className="border-brand/40 ml-3 flex flex-col gap-1.5 border-l pl-3" aria-label="Branches from Home">
          {chips.map((chip, i) => (
            <li key={i} className="relative">
              <span aria-hidden className="border-brand/40 absolute top-1/2 -left-3 h-px w-3 border-t" />
              {chip}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-foreground mt-1 text-sm font-bold">Everything hangs from Home, like branches.</p>
    </div>
  )
}

function renderChips(titles: string[]) {
  const list = titles.slice(0, 3)
  if (list.length === 0) {
    return PLACEHOLDER_TITLES.map((title) => (
      <BranchChip key={title} title={title} placeholder>
        {title}
      </BranchChip>
    ))
  }
  return list.map((title) => (
    <BranchChip key={title} title={title}>
      {title}
    </BranchChip>
  ))
}

function BranchChip({title, placeholder, children}: {title: string; placeholder?: boolean; children: React.ReactNode}) {
  return (
    <span
      title={title}
      className={`border-border bg-background motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-2 inline-flex max-w-[10rem] items-center rounded px-2 py-1 text-xs motion-safe:duration-500 ${
        placeholder ? 'text-muted-foreground border-dashed' : 'text-foreground'
      }`}
    >
      <span className="truncate">{children}</span>
    </span>
  )
}

function InfoRow({icon, children}: {icon: React.ReactNode; children: React.ReactNode}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span aria-hidden className="mt-0.5 shrink-0">
        {icon}
      </span>
      <p className="text-muted-foreground">{children}</p>
    </div>
  )
}
