import {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {HelpCircle} from 'lucide-react'
import {PanelContent} from './accessories'
import {Button} from './button'
import {Switch} from './components/switch'
import {Label} from './components/label'
import {SizableText} from './text'
import {Tooltip} from './tooltip'

/**
 * Space-wide reader settings, as stored on the space's home document. Each is
 * absent on every space published before these keys existed, so absent has to
 * read as the behaviour those spaces already have: on.
 */
export type SpaceSettings = {
  showConversations: boolean
  showActivity: boolean
  showDocumentBrowser: boolean
  showCollectionControls: boolean
}

/** Reads the space settings out of a space home document's metadata. */
export function readSpaceSettings(metadata: HMMetadata | undefined): SpaceSettings {
  return {
    showConversations: metadata?.showConversations !== false,
    showActivity: metadata?.showActivity !== false,
    showDocumentBrowser: metadata?.showDocumentBrowser !== false,
    showCollectionControls: metadata?.showCollectionControls !== false,
  }
}

/**
 * The General section of Space Settings, shown both in the home document's side
 * panel and on the full settings page. Changes apply straight to the home
 * document's metadata, the same way the rest of the document options do.
 */
export function SpaceSettingsGeneral({
  metadata,
  onMetadata,
}: {
  metadata: HMMetadata
  onMetadata: (values: Partial<HMMetadata>) => void
}) {
  const settings = readSpaceSettings(metadata)
  return (
    <div className="flex flex-col gap-2">
      <ToggleRow
        id="space-conversations"
        label="Enable Conversations"
        hint="Allow members start and join conversations on all documents."
        checked={settings.showConversations}
        onCheckedChange={(showConversations) => {
          // Activity tabs are mostly conversation surfaces, so switching
          // conversations off takes the tabs with it rather than leaving a row
          // of tabs that lead nowhere.
          onMetadata(showConversations ? {showConversations} : {showConversations, showActivity: false})
        }}
      />
      <ToggleRow
        id="space-activity"
        label="Enable Activity Tabs"
        hint="Show Conversations and Members tabs, so users can follow comments, backlinks and see who belongs to the space."
        checked={settings.showActivity}
        disabled={!settings.showConversations}
        onCheckedChange={(showActivity) => onMetadata({showActivity})}
      />
      <ToggleRow
        id="space-document-browser"
        label="Show Document Browser"
        hint="Displays the document hierarchy in the left sidebar for easier navigation."
        checked={settings.showDocumentBrowser}
        onCheckedChange={(showDocumentBrowser) => onMetadata({showDocumentBrowser})}
      />
      <ToggleRow
        id="space-collection-controls"
        label="Show Collection view options and controls"
        hint="Adds search, filter, sort, and view controls to help users find and organize subdocuments."
        checked={settings.showCollectionControls}
        onCheckedChange={(showCollectionControls) => onMetadata({showCollectionControls})}
      />
    </div>
  )
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="bg-muted flex items-center justify-between gap-4 rounded-md px-4 py-3">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id} size="sm" className={disabled ? 'text-muted-foreground' : undefined}>
          {label}
        </Label>
        <Tooltip content={hint}>
          <HelpCircle className="text-muted-foreground size-3.5 shrink-0" />
        </Tooltip>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}

/**
 * Space Settings as a side panel, opened from the home document's options menu.
 * Only the space owner sees it, so the caller is responsible for that check.
 */
export function SpaceSettingsPanel({
  metadata,
  onMetadata,
  onOpenFullSettings,
}: {
  metadata: HMMetadata
  onMetadata: (values: Partial<HMMetadata>) => void
  onOpenFullSettings?: () => void
}) {
  return (
    <PanelContent>
      <div className="flex flex-col gap-4 p-4">
        <SizableText weight="bold">General</SizableText>
        <SpaceSettingsGeneral metadata={metadata} onMetadata={onMetadata} />
        {onOpenFullSettings ? (
          <Button variant="outline" onClick={onOpenFullSettings}>
            Go to space settings
          </Button>
        ) : null}
      </div>
    </PanelContent>
  )
}
