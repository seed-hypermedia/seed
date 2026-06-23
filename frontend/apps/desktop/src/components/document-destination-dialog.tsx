import { HMWritableDocument, useSelectedAccountWritableDocuments } from '@/models/access-control'
import { useMoveDocument, useRepublishDocument } from '@/models/documents'
import { useGatewayUrl } from '@/models/gateway-settings'
import { useSelectedAccount } from '@/selected-account'
import { pathNameify } from '@/utils/path'
import { useNavigate } from '@/utils/useNavigate'
import { HMMetadataPayload, UnpackedHypermediaId } from '@seed-hypermedia/client/hm-types'
import {
  createSiteUrl,
  createWebHMUrl,
  hmId,
  hmIdPathToEntityQueryPath,
  isIdParentOfOrEqual,
  useSearch,
} from '@shm/shared'
import { getMetadataName } from '@shm/shared/content'
import { useDirectory, useResource, useResources } from '@shm/shared/models/entity'
import { canUseDocumentAsDestinationParent, isMoveTargetParentBlocked } from '@shm/shared/utils/document-actions'
import { validatePath } from '@shm/shared/utils/document-path'
import { Button } from '@shm/ui/button'
import { DialogTitle } from '@shm/ui/components/dialog'
import { Input } from '@shm/ui/components/input'
import { ScrollArea } from '@shm/ui/components/scroll-area'
import { HMIcon } from '@shm/ui/hm-icon'
import { Back, FileText, Forward, Help, Search as SearchIcon } from '@shm/ui/icons'
import { Spinner } from '@shm/ui/spinner'
import { SizableText } from '@shm/ui/text'
import { toast } from '@shm/ui/toast'
import { Tooltip } from '@shm/ui/tooltip'
import { cn } from '@shm/ui/utils'
import { useEffect, useMemo, useState } from 'react'

export type DocumentDestinationMode = 'move' | 'republish'

export type DocumentDestinationDialogInput = {
  id: UnpackedHypermediaId
  mode: DocumentDestinationMode
}

const modeCopy: Record<DocumentDestinationMode, { eyebrow: string; action: string; success: string }> = {
  move: { eyebrow: 'Move', action: 'Move', success: 'Document moved' },
  republish: { eyebrow: 'Republish', action: 'Republish', success: 'Document republished' },
}

export function DocumentDestinationDialog({
  input,
  onClose,
}: {
  input: DocumentDestinationDialogInput
  onClose: () => void
}) {
  const selectedAccount = useSelectedAccount()
  const selectedAccountUid = selectedAccount?.id.uid
  const { data: resource, isLoading, isError, error } = useResource(input.id)
  const document = resource?.type === 'document' ? resource.document : undefined
  const sourceId = resource?.type === 'document' ? resource.id : input.id
  const sourceTitle = document ? getMetadataName(document.metadata) : 'Untitled'
  const [targetParent, setTargetParent] = useState<UnpackedHypermediaId | null>(null)
  const [slug, setSlug] = useState(input.id.path?.at(-1) || '')
  const [searchQuery, setSearchQuery] = useState('')
  const writableDocuments = useSelectedAccountWritableDocuments()
  const moveDocument = useMoveDocument()
  const republishDocument = useRepublishDocument()
  const navigate = useNavigate()

  useEffect(() => {
    setTargetParent(null)
    setSlug(input.id.path?.at(-1) || '')
    setSearchQuery('')
  }, [input.id.id, input.mode])

  const destinationId = useMemo(() => {
    if (!targetParent || !slug) return null
    return hmId(targetParent.uid, { path: [...(targetParent.path || []), slug] })
  }, [targetParent, slug])
  const targetParentResource = useResource(targetParent)
  const destinationResource = useResource(destinationId)
  const destinationUrl = useDestinationUrl(destinationId)
  const targetCanWrite = !!targetParent && canWriteLocation(writableDocuments, targetParent, selectedAccountUid)
  const targetParentIsPrivate =
    targetParentResource.data?.type === 'document' &&
    !canUseDocumentAsDestinationParent(targetParentResource.data.document)
  const pathInvalid = useMemo(
    () => (destinationId ? validatePath(hmIdPathToEntityQueryPath(destinationId.path)) : null),
    [destinationId?.id],
  )
  const moveTargetBlocked = input.mode === 'move' && isMoveTargetParentBlocked(sourceId, targetParent)
  const sourceIsHomeDocument = !sourceId.path?.length
  const destinationExists = destinationResource.data?.type === 'document'
  const validationMessage = sourceIsHomeDocument
    ? 'Home documents cannot be moved or republished.'
    : !targetParent
      ? 'Choose a destination location.'
      : !targetCanWrite
        ? 'You are not allowed to write to this location.'
        : targetParentIsPrivate
          ? 'Private documents cannot contain child documents.'
          : !slug
            ? 'Enter a URL path.'
            : moveTargetBlocked
              ? 'Choose a location outside this document subtree.'
              : pathInvalid
                ? pathInvalid.error
                : destinationResource.isLoading
                  ? 'Checking destination availability…'
                  : destinationExists
                    ? 'A document already exists at this URL. Choose a different path.'
                    : null
  const mutation = input.mode === 'move' ? moveDocument : republishDocument
  const canSubmit = !!destinationId && !validationMessage && !mutation.isLoading

  if (!selectedAccountUid) {
    return <DialogError message="Select an account before moving or republishing documents." />
  }
  if (isLoading || !document) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (isError || resource?.type !== 'document') {
    return <DialogError message={error ? String(error) : 'Could not load document.'} />
  }

  return (
    <div className="flex min-h-0 flex-col gap-5">
      <div className="flex flex-col gap-1 pr-8">
        <SizableText className="text-muted-foreground text-xs font-semibold tracking-[0.18em] uppercase">
          {modeCopy[input.mode].eyebrow}
        </SizableText>
        <DialogTitle className="flex items-center gap-2 text-2xl leading-tight font-semibold">
          <HMIcon id={sourceId} name={sourceTitle} icon={document.metadata.icon} size={30} />
          <span className="min-w-0 truncate">{sourceTitle}</span>
        </DialogTitle>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <SizableText className="text-muted-foreground text-xs font-semibold tracking-[0.16em] uppercase">
            {targetParent ? 'Location' : 'Choose a site'}
          </SizableText>
          {targetParent ? <LocationBreadcrumb location={targetParent} onSelect={setTargetParent} /> : null}
        </div>
        <div className="relative">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            className="h-11 rounded-xl pl-10 text-base"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search location…"
          />
        </div>
      </div>

      <DestinationBrowser
        mode={input.mode}
        sourceId={sourceId}
        targetParent={targetParent}
        searchQuery={searchQuery}
        writableDocuments={writableDocuments}
        selectedAccountUid={selectedAccountUid}
        onSelect={(location) => {
          setTargetParent(location)
          setSearchQuery('')
        }}
        onClear={() => {
          setTargetParent(null)
          setSearchQuery('')
        }}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <SizableText className="text-muted-foreground text-xs font-semibold tracking-[0.16em] uppercase">
            URL Path
          </SizableText>
          <Tooltip content="This edits only the final URL segment. Choose the parent location above.">
            <Help className="text-muted-foreground size-4" />
          </Tooltip>
        </div>
        <Input
          className="h-11 rounded-xl text-base"
          value={slug}
          onChange={(event) => setSlug(pathNameify(event.target.value))}
          placeholder="url-path"
        />
        {destinationUrl ? (
          <SizableText
            className={cn('text-sm break-all', validationMessage ? 'text-muted-foreground' : 'text-primary')}
          >
            {destinationUrl}
          </SizableText>
        ) : null}
        {validationMessage ? <SizableText className="text-destructive text-sm">{validationMessage}</SizableText> : null}
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        <Button variant="outline" onClick={onClose} disabled={mutation.isLoading}>
          Cancel
        </Button>
        <Button
          disabled={!canSubmit}
          onClick={async () => {
            if (!destinationId || !canSubmit) return
            try {
              await mutation.mutateAsync({ from: sourceId, to: destinationId, signingAccountId: selectedAccountUid })
              onClose()
              navigate({ key: 'document', id: destinationId })
              toast.success(modeCopy[input.mode].success)
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : `Failed to ${modeCopy[input.mode].action.toLowerCase()}`,
              )
            }
          }}
        >
          {mutation.isLoading ? <Spinner /> : null}
          {modeCopy[input.mode].action}
        </Button>
      </div>
    </div>
  )
}

function DestinationBrowser({
  mode,
  sourceId,
  targetParent,
  searchQuery,
  writableDocuments,
  selectedAccountUid,
  onSelect,
  onClear,
}: {
  mode: DocumentDestinationMode
  sourceId: UnpackedHypermediaId
  targetParent: UnpackedHypermediaId | null
  searchQuery: string
  writableDocuments: HMWritableDocument[]
  selectedAccountUid: string
  onSelect: (location: UnpackedHypermediaId) => void
  onClear: () => void
}) {
  if (searchQuery.trim()) {
    return (
      <SearchResults
        mode={mode}
        sourceId={sourceId}
        query={searchQuery}
        writableDocuments={writableDocuments}
        selectedAccountUid={selectedAccountUid}
        onSelect={onSelect}
      />
    )
  }
  if (!targetParent) {
    return <WritableRoots roots={getWritableRoots(writableDocuments, selectedAccountUid)} onSelect={onSelect} />
  }
  return <ChildLocations parent={targetParent} onSelect={onSelect} onClear={onClear} />
}

function SearchResults({
  mode,
  sourceId,
  query,
  writableDocuments,
  selectedAccountUid,
  onSelect,
}: {
  mode: DocumentDestinationMode
  sourceId: UnpackedHypermediaId
  query: string
  writableDocuments: HMWritableDocument[]
  selectedAccountUid: string
  onSelect: (location: UnpackedHypermediaId) => void
}) {
  const search = useSearch(query)
  const writableResults =
    search.data?.entities
      .filter((item) => canWriteLocation(writableDocuments, item.id, selectedAccountUid))
      .filter((item) => mode !== 'move' || !isMoveTargetParentBlocked(sourceId, item.id)) || []
  const resultResources = useResources(writableResults.map((item) => item.id))
  const results: HMMetadataPayload[] = writableResults
    .filter((_, index) => {
      const resource = resultResources[index]?.data
      return resource?.type === 'document' && canUseDocumentAsDestinationParent(resource.document)
    })
    .map((item) => ({ id: item.id, metadata: { name: item.title } }))
  const loadingLabel =
    search.isLoading || resultResources.some((result) => result.isLoading)
      ? 'Loading locations…'
      : 'No writable locations found.'
  return (
    <LocationList emptyLabel={loadingLabel}>
      {results.map((item) => (
        <LocationRow key={item.id.id} id={item.id} title={item.metadata?.name || 'Untitled'} onSelect={onSelect} />
      ))}
    </LocationList>
  )
}

function WritableRoots({
  roots,
  onSelect,
}: {
  roots: HMWritableDocument[]
  onSelect: (location: UnpackedHypermediaId) => void
}) {
  return (
    <LocationList emptyLabel="No writable destinations available for the selected account.">
      {roots.filter(isPublicWritableDocument).map((item) => {
        const title = item.entity.document ? getMetadataName(item.entity.document.metadata) : item.entity.id.uid
        return <LocationRow key={item.entity.id.id} id={item.entity.id} title={title} onSelect={onSelect} />
      })}
    </LocationList>
  )
}

function ChildLocations({
  parent,
  onSelect,
  onClear,
}: {
  parent: UnpackedHypermediaId
  onSelect: (location: UnpackedHypermediaId) => void
  onClear: () => void
}) {
  const { data: directory, isLoading } = useDirectory(parent, { mode: 'Children' })
  const parentLocation = parent.path?.length ? hmId(parent.uid, { path: parent.path.slice(0, -1) }) : null
  return (
    <LocationList emptyLabel={isLoading ? 'Loading locations…' : 'No subdocuments in this location.'}>
      <div className="bg-muted/30 border-border border-b p-4">
        <Button variant="outline" size="sm" onClick={() => (parentLocation ? onSelect(parentLocation) : onClear())}>
          <Back className="size-4" />
          Back
        </Button>
      </div>
      {directory
        ?.filter(canUseDocumentAsDestinationParent)
        .map((item) => (
          <LocationRow
            key={item.id.id}
            id={item.id}
            title={getMetadataName(item.metadata)}
            suffix={item.path?.at(-1)}
            onSelect={onSelect}
          />
        ))}
    </LocationList>
  )
}

function LocationList({ children, emptyLabel }: { children: React.ReactNode; emptyLabel: string }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children
  return (
    <ScrollArea className="border-border -mx-5 h-60 border-y">
      <div className="flex min-h-40 flex-col">
        {hasChildren ? children : <SizableText className="text-muted-foreground p-5 text-sm">{emptyLabel}</SizableText>}
      </div>
    </ScrollArea>
  )
}

function LocationRow({
  id,
  title,
  suffix,
  onSelect,
}: {
  id: UnpackedHypermediaId
  title: string
  suffix?: string
  onSelect: (location: UnpackedHypermediaId) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className="hover:bg-muted/70 focus-visible:ring-ring border-border flex min-h-14 items-center gap-3 border-b px-5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <HMIcon id={id} name={title} size={28} />
      <div className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
        <SizableText className="truncate text-base font-medium">{title}</SizableText>
        {suffix ? <SizableText className="text-muted-foreground truncate text-xs">{suffix}</SizableText> : null}
      </div>
      <Forward className="text-muted-foreground size-4" />
    </button>
  )
}

function LocationBreadcrumb({
  location,
  onSelect,
}: {
  location: UnpackedHypermediaId
  onSelect: (id: UnpackedHypermediaId) => void
}) {
  const siteId = hmId(location.uid, { latest: true })
  const { data: siteResource } = useResource(siteId)
  const siteTitle = siteResource?.type === 'document' ? getMetadataName(siteResource.document.metadata) : location.uid
  const ancestorIds = useMemo(
    () => location.path?.map((_, index) => hmId(location.uid, { path: location.path?.slice(0, index + 1) })) || [],
    [location.id],
  )
  const ancestors = useResources(ancestorIds)
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
      <button type="button" className="font-medium hover:underline" onClick={() => onSelect(hmId(location.uid))}>
        {siteTitle}
      </button>
      {ancestors.map((ancestor, index) => {
        const doc = ancestor.data?.type === 'document' ? ancestor.data.document : null
        const id = ancestorIds[index]
        if (!id) return null
        return (
          <span key={id.id} className="flex min-w-0 items-center gap-1.5">
            <span className="text-muted-foreground">/</span>
            <button
              type="button"
              className="max-w-48 truncate font-medium hover:underline"
              onClick={() => onSelect(id)}
            >
              {doc ? getMetadataName(doc.metadata) : id.path?.at(-1)}
            </button>
          </span>
        )
      })}
    </div>
  )
}

function useDestinationUrl(location: UnpackedHypermediaId | null) {
  const gatewayUrl = useGatewayUrl()
  const { data: siteResource } = useResource(location ? hmId(location.uid, { latest: true }) : null)
  if (!location) return null
  const siteDocument = siteResource?.type === 'document' ? siteResource.document : undefined
  const siteUrl = siteDocument?.metadata.siteUrl
  if (siteUrl) return createSiteUrl({ path: location.path, hostname: siteUrl })
  if (!gatewayUrl.data) return null
  return createWebHMUrl(location.uid, { path: location.path, hostname: gatewayUrl.data })
}

function DialogError({ message }: { message: string }) {
  return (
    <div className="border-destructive/30 bg-destructive/10 flex min-h-32 items-center gap-3 rounded-lg border p-4">
      <FileText className="text-destructive size-5" />
      <SizableText className="text-destructive text-sm">{message}</SizableText>
    </div>
  )
}

function canWriteLocation(
  writableDocuments: HMWritableDocument[],
  location: UnpackedHypermediaId,
  selectedAccountUid?: string | null,
) {
  if (!selectedAccountUid) return false
  return writableDocuments.some(
    (document) =>
      isIdParentOfOrEqual(document.entity.id, location) && document.accountsWithWrite.includes(selectedAccountUid),
  )
}

function getWritableRoots(writableDocuments: HMWritableDocument[], selectedAccountUid: string) {
  const roots = writableDocuments.filter((document) => document.accountsWithWrite.includes(selectedAccountUid))
  const deduped = new Map<string, HMWritableDocument>()
  roots.forEach((document) => {
    if (!deduped.has(document.entity.id.id)) deduped.set(document.entity.id.id, document)
  })
  return Array.from(deduped.values())
}

function isPublicWritableDocument(document: HMWritableDocument) {
  return !document.entity.document || canUseDocumentAsDestinationParent(document.entity.document)
}
