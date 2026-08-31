/**
 * Space Settings → Extensions.
 *
 * Lists the extensions installed on a site (the `extensions` map of its home
 * document metadata), lets the owner install one from an `hm://` URL, re-pin a
 * pinned install to the extension's latest version, hide it from navigation,
 * and remove it. Every write goes through `useUpdateHomeDocument`, which diffs
 * the full metadata we hand it against the published metadata — see
 * `@/utils/extension-installs` for the map edits and the resulting ops.
 *
 * docs/extensions/design.md §4.3.
 */

import {domainResolver} from '@/grpc-client'
import {useUpdateHomeDocument} from '@/models/site'
import {
  buildInstallRecord,
  getRawExtensionInstalls,
  installExtension,
  normalizeMountPath,
  removeExtension,
  setExtensionNav,
  shortVersion,
  updateExtensionVersion,
  validateMountPath,
  type RawExtensionInstalls,
} from '@/utils/extension-installs'
import {useNavigate} from '@/utils/useNavigate'
import {
  parseExtensionInstalls,
  parseExtensionManifest,
  type ExtensionManifest,
  type ExtensionMount,
} from '@seed-hypermedia/client/extensions'
import type {HMDocument, HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useIsSiteOwner} from '@shm/shared/models/capabilities'
import {useResource} from '@shm/shared/models/entity'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {Checkbox} from '@shm/ui/components/checkbox'
import {Input} from '@shm/ui/components/input'
import {Switch} from '@shm/ui/components/switch'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import {ExternalLink, Puzzle, Trash2} from 'lucide-react'
import {useState} from 'react'

export function ExtensionsSettings({siteId}: {siteId: UnpackedHypermediaId}) {
  const accountUid = siteId.uid
  const resource = useResource(siteId)
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const {isSiteOwner, isLoading: isOwnerLoading} = useIsSiteOwner(accountUid)
  const updateHome = useUpdateHomeDocument(accountUid)
  const [installOpen, setInstallOpen] = useState(false)

  if (resource.isInitialLoading || isOwnerLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }
  if (!document) {
    return <SizableText color="muted">This account doesn't have a space yet.</SizableText>
  }
  if (!isSiteOwner) {
    return (
      <>
        <SizableText size="2xl" weight="bold">
          Extensions
        </SizableText>
        <SizableText color="muted">Only the space owner can manage extensions.</SizableText>
      </>
    )
  }

  const metadata = document.metadata
  const rawInstalls = getRawExtensionInstalls(metadata)
  const mounts = parseExtensionInstalls(metadata)

  async function writeInstalls(next: RawExtensionInstalls, successMessage: string) {
    try {
      const nextMetadata = {...metadata, extensions: next} as HMMetadata
      await updateHome.mutateAsync({metadata: nextMetadata})
      toast.success(successMessage)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update extensions')
      return false
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <SizableText size="2xl" weight="bold">
          Extensions
        </SizableText>
        {!installOpen ? (
          <Button variant="default" onClick={() => setInstallOpen(true)}>
            Install extension
          </Button>
        ) : null}
      </div>
      <SizableText size="sm" color="muted">
        Extensions are apps published as hypermedia documents. An installed extension is served at its mount path on
        this space, on the web and in the app.
      </SizableText>

      {installOpen ? (
        <InstallExtensionForm
          existing={rawInstalls}
          isPending={updateHome.isPending}
          onCancel={() => setInstallOpen(false)}
          onInstall={async (mountPath, record) => {
            let next: RawExtensionInstalls
            try {
              next = installExtension(rawInstalls, mountPath, record)
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Invalid mount path')
              return
            }
            if (await writeInstalls(next, `Extension installed at /${mountPath}`)) setInstallOpen(false)
          }}
        />
      ) : null}

      {mounts.length === 0 ? (
        <SizableText color="muted">No extensions are installed on this space.</SizableText>
      ) : (
        <div className="flex flex-col gap-3">
          {mounts.map((mount) => (
            <InstalledExtensionRow
              key={mount.mountPath}
              siteUid={accountUid}
              mount={mount}
              isPending={updateHome.isPending}
              onUpdate={(version) =>
                writeInstalls(
                  updateExtensionVersion(rawInstalls, mount.mountPath, version),
                  `Updated /${mount.mountPath} to the latest version`,
                )
              }
              onToggleNav={(nav) =>
                writeInstalls(
                  setExtensionNav(rawInstalls, mount.mountPath, nav),
                  nav ? `/${mount.mountPath} shown in navigation` : `/${mount.mountPath} hidden from navigation`,
                )
              }
              onRemove={() =>
                writeInstalls(
                  removeExtension(rawInstalls, mount.mountPath),
                  `Extension removed from /${mount.mountPath}`,
                )
              }
            />
          ))}
        </div>
      )}
    </>
  )
}

/** Resolve an install record's `ext` URL into the pinned and latest extension documents. */
function useExtensionDocuments(mount: ExtensionMount) {
  const extId = unpackHmId(mount.record.ext)
  const pinnedId = extId
    ? hmId(extId.uid, {path: extId.path, version: mount.record.version || null, latest: !mount.record.version})
    : null
  const latestId = extId ? hmId(extId.uid, {path: extId.path}) : null
  // `subscribed` so the daemon discovers the (third-party) extension document
  // and its versions; an unsubscribed lookup only sees already-synced blobs.
  const pinned = useResource(pinnedId, {subscribed: true})
  const latest = useResource(mount.record.version ? latestId : null, {subscribed: true})
  const pinnedDoc = pinned.data?.type === 'document' ? pinned.data.document : undefined
  const latestDoc = latest.data?.type === 'document' ? latest.data.document : undefined
  return {
    extId,
    pinnedDoc,
    latestDoc,
    isLoading: pinned.isInitialLoading || !!pinned.isDiscovering,
    manifest: pinnedDoc ? parseExtensionManifest(pinnedDoc.metadata) : null,
  }
}

function InstalledExtensionRow({
  siteUid,
  mount,
  isPending,
  onUpdate,
  onToggleNav,
  onRemove,
}: {
  siteUid: string
  mount: ExtensionMount
  isPending: boolean
  onUpdate: (version: string) => void
  onToggleNav: (nav: boolean) => void
  onRemove: () => void
}) {
  const navigate = useNavigate()
  const {extId, pinnedDoc, latestDoc, isLoading, manifest} = useExtensionDocuments(mount)
  const {record} = mount
  const name = record.title || pinnedDoc?.metadata?.name || extId?.path?.at(-1) || record.ext
  const latestVersion = latestDoc?.version
  const updateAvailable = !!record.version && !!latestVersion && latestVersion !== record.version
  const navVisible = record.nav !== false

  return (
    <div className="border-border flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <Puzzle className="text-muted-foreground size-4 shrink-0" />
            <SizableText weight="medium" className="truncate">
              {name}
            </SizableText>
            {isLoading ? <Spinner /> : null}
            {pinnedDoc && !manifest ? <Badge tone="warning">not an extension</Badge> : null}
          </div>
          <SizableText size="xs" color="muted" className="font-mono">
            /{mount.mountPath}
          </SizableText>
          {manifest?.description ? (
            <SizableText size="sm" color="muted">
              {manifest.description}
            </SizableText>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Badge>{record.version ? `pinned ${shortVersion(record.version)}` : 'follows latest'}</Badge>
            {manifest ? <Badge>v{manifest.version}</Badge> : null}
            <PermissionBadges manifest={manifest} />
          </div>
          <SizableText size="xs" color="muted" className="truncate font-mono">
            {record.ext}
          </SizableText>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate({key: 'document', id: hmId(siteUid, {path: mount.mountSegments})})}
          >
            <ExternalLink className="size-3.5" />
            Open
          </Button>
          {updateAvailable && latestVersion ? (
            <Button size="sm" variant="brand" disabled={isPending} onClick={() => onUpdate(latestVersion)}>
              Update to latest
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="text-destructive" disabled={isPending} onClick={onRemove}>
            <Trash2 className="size-3.5" />
            Remove
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={navVisible} disabled={isPending} onCheckedChange={(checked) => onToggleNav(!!checked)} />
        <SizableText size="sm">Show in site navigation</SizableText>
      </div>
    </div>
  )
}

/** Turn what the user pasted into a document id: `hm://…`, a gateway `https://host/hm/…` URL, or a site URL. */
async function resolvePastedExtensionUrl(input: string): Promise<UnpackedHypermediaId> {
  const value = input.trim()
  if (!value) throw new Error('Paste the hm:// URL of the extension')
  const direct = unpackHmId(value)
  if (direct?.uid) return direct
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value)
    const resolved = await domainResolver(url.hostname)
    const uid = typeof resolved === 'string' ? resolved : resolved?.registeredAccountUid
    if (uid) {
      const path = url.pathname.split('/').filter(Boolean)
      return hmId(uid, {path})
    }
    throw new Error(`Could not resolve a Seed space at ${url.hostname}`)
  }
  throw new Error('Not a valid hm:// URL')
}

function InstallExtensionForm({
  existing,
  isPending,
  onCancel,
  onInstall,
}: {
  existing: RawExtensionInstalls
  isPending: boolean
  onCancel: () => void
  onInstall: (mountPath: string, record: ReturnType<typeof buildInstallRecord>) => Promise<void>
}) {
  const [url, setUrl] = useState('')
  const [resolving, setResolving] = useState(false)
  const [extId, setExtId] = useState<UnpackedHypermediaId | null>(null)
  const [mountPathDraft, setMountPathDraft] = useState<string | null>(null)
  const [pin, setPin] = useState(true)
  const [title, setTitle] = useState('')

  // `subscribed` so the daemon discovers the pasted document from the network;
  // the first query resolves to not-found before discovery completes, so the
  // form stays in its loading state while `isDiscovering`.
  const resource = useResource(extId ? hmId(extId.uid, {path: extId.path}) : null, {subscribed: true})
  const doc = resource.data?.type === 'document' ? resource.data.document : undefined
  const loading = !!extId && (resource.isInitialLoading || !!resource.isDiscovering)
  const notFound = !!extId && !loading && !doc
  const manifest = doc ? parseExtensionManifest(doc.metadata) : null

  const proposedMountPath = manifest?.defaultMountPath || extId?.path?.at(-1) || ''
  const mountPath = normalizeMountPath(mountPathDraft ?? proposedMountPath)
  const mountPathError = extId && manifest ? validateMountPath(mountPath, existing) : null
  const canInstall = !!extId && !!manifest && !mountPathError && !isPending

  async function handleResolve() {
    setResolving(true)
    try {
      const id = await resolvePastedExtensionUrl(url)
      setExtId(id)
      setMountPathDraft(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not resolve that URL')
    } finally {
      setResolving(false)
    }
  }

  async function handleInstall() {
    if (!extId || !doc || !manifest) return
    const record = buildInstallRecord({
      extensionId: extId,
      pinnedVersion: pin ? doc.version : null,
      title,
    })
    await onInstall(mountPath, record)
  }

  return (
    <div className="border-border bg-muted/30 flex flex-col gap-4 rounded-lg border p-4">
      <SizableText weight="medium">Install an extension</SizableText>
      <div className="flex gap-2">
        <Input
          value={url}
          placeholder="hm://z6Mk…/my-extension"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleResolve()
          }}
        />
        <Button variant="outline" disabled={resolving || !url.trim()} onClick={handleResolve}>
          {resolving ? 'Resolving…' : 'Fetch'}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2">
          <Spinner />
          <SizableText size="sm" color="muted">
            Loading extension…
          </SizableText>
        </div>
      ) : null}
      {notFound ? <SizableText color="destructive">Could not load that document.</SizableText> : null}
      {doc && !manifest ? (
        <SizableText color="destructive">
          "{doc.metadata?.name || extId?.id}" is not an extension (no valid seedExtension manifest).
        </SizableText>
      ) : null}

      {doc && manifest ? (
        <ExtensionPreview doc={doc} manifest={manifest}>
          <div className="flex flex-col gap-3 pt-2">
            <label className="flex flex-col gap-1">
              <SizableText size="sm" weight="medium">
                Mount path
              </SizableText>
              <div className="flex items-center gap-1">
                <SizableText color="muted">/</SizableText>
                <Input
                  value={mountPathDraft ?? proposedMountPath}
                  onChange={(e) => setMountPathDraft(e.target.value)}
                  placeholder="board"
                  className="font-mono"
                />
              </div>
              {mountPathError ? (
                <SizableText size="xs" color="destructive">
                  {mountPathError}
                </SizableText>
              ) : (
                <SizableText size="xs" color="muted">
                  The extension will be served at this path on the space.
                </SizableText>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <SizableText size="sm" weight="medium">
                Navigation title (optional)
              </SizableText>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={doc.metadata?.name || 'Extension'}
              />
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={pin} onCheckedChange={(checked) => setPin(checked === true)} />
              <SizableText size="sm">Pin to this version ({shortVersion(doc.version)})</SizableText>
            </label>
            <SizableText size="xs" color="muted">
              {pin
                ? 'The space keeps running exactly this version until you update it here.'
                : 'The space will run whatever version the author publishes next, without review.'}
            </SizableText>
          </div>
        </ExtensionPreview>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button variant="default" disabled={!canInstall} onClick={handleInstall}>
          {isPending ? 'Installing…' : 'Install'}
        </Button>
      </div>
    </div>
  )
}

function ExtensionPreview({
  doc,
  manifest,
  children,
}: {
  doc: HMDocument
  manifest: ExtensionManifest
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Puzzle className="text-muted-foreground size-4" />
        <SizableText weight="medium">{doc.metadata?.name || 'Untitled extension'}</SizableText>
        <Badge>v{manifest.version}</Badge>
        <Badge>{manifest.kind}</Badge>
      </div>
      {manifest.description ? (
        <SizableText size="sm" color="muted">
          {manifest.description}
        </SizableText>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <SizableText size="xs" color="muted">
          Permissions:
        </SizableText>
        <PermissionBadges manifest={manifest} />
      </div>
      {manifest.homepage ? (
        <SizableText size="xs" color="muted" className="truncate font-mono">
          {manifest.homepage}
        </SizableText>
      ) : null}
      {children}
    </div>
  )
}

const PERMISSION_LABELS: Record<string, string> = {
  sign: 'sign as you (confirmed each time)',
  navigate: 'navigate / open links',
  storage: 'local storage',
}

function PermissionBadges({manifest}: {manifest: ExtensionManifest | null}) {
  if (!manifest) return null
  if (manifest.permissions.length === 0) return <Badge>read only</Badge>
  return (
    <>
      {manifest.permissions.map((permission) => (
        <Badge key={permission} tone="brand">
          {PERMISSION_LABELS[permission] || permission}
        </Badge>
      ))}
    </>
  )
}

function Badge({children, tone}: {children: React.ReactNode; tone?: 'brand' | 'warning'}) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[11px] leading-4',
        tone === 'brand'
          ? 'bg-brand/10 text-brand-2'
          : tone === 'warning'
            ? 'bg-yellow-500/15 text-yellow-800 dark:text-yellow-300'
            : 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  )
}
