import type {HMDocument, HMMetadata} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {getQueryClient, invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useUniversalClient} from '@shm/shared/routing'
import {readSpaceSettings, SPACE_SETTING_KEYS, type SpaceSettings} from '@shm/shared/space-settings'
import {getDocAttributeChanges} from '@shm/shared/utils/document-changes'
import {useMutation} from '@tanstack/react-query'
import {HelpCircle} from 'lucide-react'
import {useState} from 'react'
import {Button} from './button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './components/alert-dialog'
import {Label} from './components/label'
import {ScrollArea} from './components/scroll-area'
import {Switch} from './components/switch'
import {Spinner} from './spinner'
import {toast} from './toast'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/**
 * The published home document of a space, which carries its settings. Uses the
 * same id the page uses for the site header, so it shares that cache entry.
 */
export function useSpaceHome(spaceUid: string | null | undefined): HMDocument | undefined {
  const home = useResource(spaceUid ? hmId(spaceUid, {latest: true}) : null)
  return home.data?.type === 'document' ? home.data.document : undefined
}

/**
 * The settings of the space a document lives in. Until the home document loads
 * every setting reads as on.
 */
export function useSpaceSettings(spaceUid: string | null | undefined): SpaceSettings {
  return readSpaceSettings(useSpaceHome(spaceUid)?.metadata)
}

/**
 * Unsaved edits to a space's General settings. Saving publishes the home
 * document straight away rather than going through a draft, so a setting never
 * waits on, or ships with, unrelated content edits to the home page.
 */
export function useSpaceSettingsForm(spaceUid: string) {
  const client = useUniversalClient()
  const home = useSpaceHome(spaceUid)
  const [edits, setEdits] = useState<Partial<HMMetadata>>({})
  const metadata = {...home?.metadata, ...edits} as HMMetadata
  const changedKeys = changedSettingKeys(home?.metadata, metadata)

  const mutation = useMutation({
    mutationFn: async (next: HMMetadata) => {
      if (!home || !client.publishDocument) throw new Error('Space settings can only be saved from the desktop app.')
      const target = {...home.metadata} as Record<string, unknown>
      for (const key of changedSettingKeys(home.metadata, next)) target[key] = next[key]
      const changes = getDocAttributeChanges(target as HMMetadata, home.metadata)
      if (!changes.length) return
      await client.publishDocument({
        signerAccountUid: spaceUid,
        account: spaceUid,
        baseVersion: home.version,
        genesis: home.genesis,
        generation: home.generationInfo?.generation,
        changes,
      })
    },
    onSuccess: async () => {
      const homeId = hmId(spaceUid).id
      invalidateQueries([queryKeys.ENTITY, homeId])
      invalidateQueries([queryKeys.RESOLVED_ENTITY, homeId])
      await getQueryClient().refetchQueries({queryKey: [queryKeys.ENTITY, homeId]})
      setEdits({})
    },
  })

  function save() {
    mutation.mutateAsync(metadata).then(
      () => toast.success('Space settings saved'),
      // Edits stay in place, so retrying sends the same settings again.
      (error) =>
        toast.error(error instanceof Error ? error.message : 'Could not save space settings', {
          action: {label: 'Retry', onClick: save},
        }),
    )
  }

  return {
    /** False until the home document loads; before that every toggle would read as on. */
    isReady: !!home,
    metadata,
    onMetadata: (values: Partial<HMMetadata>) => setEdits((current) => ({...current, ...values})),
    isDirty: changedKeys.length > 0,
    isSaving: mutation.isPending,
    save,
  }
}

function changedSettingKeys(published: HMMetadata | undefined, next: HMMetadata) {
  const before = readSpaceSettings(published)
  const after = readSpaceSettings(next)
  return SPACE_SETTING_KEYS.filter((key) => before[key] !== after[key])
}

/**
 * The General section of Space Settings, shown both in the home document's side
 * panel and on the full settings page.
 */
export function SpaceSettingsGeneral({
  metadata,
  onMetadata,
  className,
}: {
  metadata: HMMetadata
  onMetadata: (values: Partial<HMMetadata>) => void
  className?: string
}) {
  const settings = readSpaceSettings(metadata)
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <SettingsToggle
        id="space-conversations"
        label="Enable Conversations"
        hint="Allow members start and join conversations on all documents."
        checked={settings.showConversations}
        onCheckedChange={(showConversations) => {
          // Switching off conversations also switches off activity tabs.
          onMetadata(showConversations ? {showConversations} : {showConversations, showActivity: false})
        }}
      />
      <SettingsToggle
        id="space-activity"
        label="Enable Activity Tabs"
        hint="Show Conversations and Members tabs, so users can follow comments, backlinks and see who belongs to the space."
        checked={settings.showActivity}
        disabled={!settings.showConversations}
        onCheckedChange={(showActivity) => onMetadata({showActivity})}
      />
      <SettingsToggle
        id="space-document-browser"
        label="Show Document Browser"
        hint="Displays the document hierarchy in the left sidebar for easier navigation."
        checked={settings.showDocumentBrowser}
        onCheckedChange={(showDocumentBrowser) => onMetadata({showDocumentBrowser})}
      />
      <SettingsToggle
        id="space-collection-controls"
        label="Show Collection view options and controls"
        hint="Adds search, filter, sort, and view controls to help users find and organize subdocuments."
        checked={settings.showCollectionControls}
        onCheckedChange={(showCollectionControls) => onMetadata({showCollectionControls})}
      />
    </div>
  )
}

/** A labelled settings switch with a `?` tooltip. */
export function SettingsToggle({
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
        <Label htmlFor={id} className={disabled ? 'text-muted-foreground' : undefined}>
          {label}
        </Label>
        <Tooltip content={hint}>
          <HelpCircle className="text-muted-foreground size-4 shrink-0" />
        </Tooltip>
      </div>
      <Switch id={id} size="lg" checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}

/** Asks before throwing away unsaved settings. Open while `onDiscard` is set. */
export function DiscardChangesDialog({onDiscard, onCancel}: {onDiscard: (() => void) | null; onCancel: () => void}) {
  return (
    <AlertDialog
      open={!!onDiscard}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>You have unsaved changes. Discard?</AlertDialogTitle>
          <AlertDialogDescription>Your changes to these settings will be lost.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={() => onDiscard?.()}>Discard</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Space Settings as a side panel, opened from the home document's options menu.
 * Only the space owner sees it, so the caller is responsible for that check.
 */
export function SpaceSettingsPanel({spaceUid, onOpenFullSettings}: {spaceUid: string; onOpenFullSettings: () => void}) {
  const form = useSpaceSettingsForm(spaceUid)
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null)
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {form.isReady ? (
            <SpaceSettingsGeneral metadata={form.metadata} onMetadata={form.onMetadata} />
          ) : (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="border-border flex flex-wrap gap-2 border-t p-4">
        <Button
          variant="outline"
          className="flex-1 basis-40"
          onClick={() => (form.isDirty ? setPendingDiscard(() => onOpenFullSettings) : onOpenFullSettings())}
        >
          Go to space settings
        </Button>
        <Button className="flex-1 basis-40" disabled={!form.isDirty || form.isSaving} onClick={form.save}>
          {form.isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <DiscardChangesDialog onDiscard={pendingDiscard} onCancel={() => setPendingDiscard(null)} />
    </div>
  )
}
