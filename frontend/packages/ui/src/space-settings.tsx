import type {HMDocument, HMMetadata, HMNavigationItem, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {getQueryClient, invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {readSpaceSettings, SPACE_SETTING_KEYS, type SpaceSettings} from '@shm/shared/space-settings'
import {useMutation} from '@tanstack/react-query'
import {ArrowLeft, HelpCircle, type LucideIcon} from 'lucide-react'
import {useEffect, useRef, useState, type ReactNode} from 'react'
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
import {Switch} from './components/switch'
import {SizableText} from './text'
import {toast} from './toast'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/** A change to a space's home document. */
export type SpaceHomeUpdate = {
  /** Merges edited fields into the latest published metadata, so concurrent changes survive. */
  updateMetadata?: (current: HMMetadata) => HMMetadata
  navigation?: HMNavigationItem[]
}

/** How a platform publishes a space's home document: desktop signs with the account, web with its delegation. */
export type SpaceHomeUpdater = {
  mutateAsync: (update: SpaceHomeUpdate) => Promise<unknown>
  isPending: boolean
}

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
export function useSpaceSettingsForm(spaceUid: string, updateHome: SpaceHomeUpdater) {
  const home = useSpaceHome(spaceUid)
  const [edits, setEdits] = useState<Partial<HMMetadata>>({})
  const metadata = {...home?.metadata, ...edits} as HMMetadata
  const changedKeys = changedSettingKeys(home?.metadata, metadata)

  const mutation = useMutation({
    mutationFn: async (next: HMMetadata) => {
      const changes: Partial<HMMetadata> = {}
      for (const key of changedSettingKeys(home?.metadata, next)) changes[key] = next[key]
      await updateHome.mutateAsync({updateMetadata: (current) => ({...current, ...changes})})
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

/** Tells the page whether a tab has unsaved edits, and that it has none once it closes. */
export function useReportDirty(isDirty: boolean, onDirtyChange: (isDirty: boolean) => void) {
  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
}

/** The General tab of Space Settings. */
export function SpaceSettingsGeneralTab({
  siteId,
  updateHome,
  onDirtyChange,
}: {
  siteId: UnpackedHypermediaId
  updateHome: SpaceHomeUpdater
  onDirtyChange: (isDirty: boolean) => void
}) {
  const form = useSpaceSettingsForm(siteId.uid, updateHome)
  useReportDirty(form.isDirty, onDirtyChange)
  return (
    <>
      <div className="flex items-center justify-between">
        <SizableText size="2xl" weight="bold">
          General
        </SizableText>
        <Button variant="default" disabled={!form.isDirty || form.isSaving} onClick={form.save}>
          {form.isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <SpaceSettingsGeneral
        metadata={form.metadata}
        onMetadata={form.onMetadata}
        className="grid grid-cols-1 gap-3 lg:grid-cols-2"
      />
    </>
  )
}

/** The switches of the General tab. */
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
        <SettingHint label={label} hint={hint} />
      </div>
      <Switch id={id} size="lg" checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}

/** The list of space settings tabs. */
export function SpaceSettingsNav<Tab extends string>({
  tabs,
  activeTab,
  onSelect,
  className,
  children,
}: {
  tabs: readonly {key: Tab; icon: LucideIcon; label: string}[]
  activeTab: Tab
  onSelect: (tab: Tab) => void
  className?: string
  /** Shown above the tabs. */
  children?: ReactNode
}) {
  return (
    <nav aria-label="Space Settings" className={cn('flex flex-col gap-1 p-2', className)}>
      {children}
      <SizableText size="xs" weight="bold" color="muted" className="px-3 py-2 uppercase">
        Space Settings
      </SizableText>
      {tabs.map(({key, icon: Icon, label}) => (
        <button
          key={key}
          type="button"
          aria-current={activeTab === key ? 'page' : undefined}
          className={cn(
            'flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors',
            activeTab === key ? 'bg-brand/10 text-brand-2 font-medium' : 'text-muted-foreground hover:bg-muted',
          )}
          onClick={() => onSelect(key)}
        >
          <Icon className="size-4" />
          {label}
        </button>
      ))}
    </nav>
  )
}

export function SpaceSettingsBackLink({onClick, className}: {onClick: () => void; className?: string}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-muted-foreground hover:text-foreground flex items-center gap-1.5 self-start text-sm transition-colors',
        className,
      )}
    >
      <ArrowLeft className="size-4" />
      Back to space
    </button>
  )
}

/** A tooltip for a space settings switch */
function SettingHint({label, hint}: {label: string; hint: string}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const wasOpenOnPress = useRef(false)

  // iOS sends no click for a tap on a blank area, which is what the tooltip's own dismissal waits for.
  useEffect(() => {
    if (!open) return
    const closeOnPressElsewhere = (event: globalThis.PointerEvent) => {
      if (!buttonRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPressElsewhere)
    return () => document.removeEventListener('pointerdown', closeOnPressElsewhere)
  }, [open])

  return (
    <Tooltip asChild content={hint} open={open} onOpenChange={setOpen}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`About ${label}`}
        className="shrink-0"
        onPointerDown={() => {
          wasOpenOnPress.current = open
        }}
        onClick={(event) => {
          event.preventDefault()
          setOpen(!wasOpenOnPress.current)
        }}
      >
        <HelpCircle className="text-muted-foreground size-4" />
      </button>
    </Tooltip>
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
