import type {HMDocument, HMMetadataPayload, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  createSiteUrl,
  createWebHMUrl,
  hmId,
  hmIdPathToEntityQueryPath,
  isIdParentOfOrEqual,
  useSearch,
  useUniversalAppContext,
} from '@shm/shared'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {getMetadataName} from '@shm/shared/content'
import {useDirectory, useResource, useResources} from '@shm/shared/models/entity'
import {
  canUseDocumentAsDestinationParent,
  isMoveTargetParentBlocked,
  type DocumentCardActionOrigin,
} from '@shm/shared/utils/document-actions'
import {validatePath} from '@shm/shared/utils/document-path'
import {pathNameify} from '@shm/shared/utils/path'
import {useEffect, useMemo, useState} from 'react'
import {Button} from './button'
import {DialogTitle} from './components/dialog'
import {Input} from './components/input'
import {ScrollArea} from './components/scroll-area'
import {HMIcon} from './hm-icon'
import {Back, FileText, Forward, Help, Search as SearchIcon} from './icons'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {toast} from './toast'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/** Destination action supported by the shared document destination dialog. */
export type DocumentDestinationMode = 'move' | 'republish'

/** Input passed when opening the shared document destination dialog. */
export type DocumentDestinationDialogInput = {
  id: UnpackedHypermediaId
  mode: DocumentDestinationMode
  origin?: DocumentCardActionOrigin
}

/** Writable location root that can be selected or browsed in the destination dialog. */
export type WritableDocumentDestination = {
  id: UnpackedHypermediaId
  accountsWithWrite?: string[]
  title?: string
  document?: HMDocument | null
}

/** Payload submitted by the shared document destination dialog. */
export type DocumentDestinationSubmitInput = {
  from: UnpackedHypermediaId
  to: UnpackedHypermediaId
  mode: DocumentDestinationMode
  signingAccountId: string
  origin?: DocumentCardActionOrigin
}

const modeCopy: Record<DocumentDestinationMode, {eyebrow: string; action: string; success: string}> = {
  move: {eyebrow: 'Move', action: 'Move', success: 'Document moved'},
  republish: {eyebrow: 'Republish', action: 'Republish', success: 'Document republished'},
}

/** Renders the shared destination picker for move and republish flows. */
export function DocumentDestinationDialog({
  input,
  onClose,
  selectedAccountUid,
  writableDocuments,
  enabledModes = ['move', 'republish'],
  onSubmit,
  onSuccess,
}: {
  input: DocumentDestinationDialogInput
  onClose: () => void
  selectedAccountUid?: string | null
  writableDocuments: WritableDocumentDestination[]
  enabledModes?: DocumentDestinationMode[]
  onSubmit: (input: DocumentDestinationSubmitInput) => Promise<void>
  onSuccess?: (input: DocumentDestinationSubmitInput) => void
}) {
  const {data: resource, isLoading, isError, error} = useResource(input.id)
  const document = resource?.type === 'document' ? resource.document : undefined
  const sourceId = resource?.type === 'document' ? resource.id : input.id
  const sourceTitle = document ? getMetadataName(document.metadata) : 'Untitled'
  const [targetParent, setTargetParent] = useState<UnpackedHypermediaId | null>(null)
  const [slug, setSlug] = useState(input.id.path?.at(-1) || '')
  const [searchQuery, setSearchQuery] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setTargetParent(null)
    setSlug(input.id.path?.at(-1) || '')
    setSearchQuery('')
    setIsSubmitting(false)
  }, [input.id.id, input.mode])

  const destinationId = useMemo(() => {
    if (!targetParent || !slug) return null
    return hmId(targetParent.uid, {path: [...(targetParent.path || []), slug]})
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
  const modeDisabled = !enabledModes.includes(input.mode)
  const moveTargetBlocked = input.mode === 'move' && isMoveTargetParentBlocked(sourceId, targetParent)
  const sourceIsHomeDocument = !sourceId.path?.length
  const destinationExists = destinationResource.data?.type === 'document'
  const validationMessage = modeDisabled
    ? `${modeCopy[input.mode].action} is not available here.`
    : sourceIsHomeDocument
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
  const canSubmit = !!destinationId && !validationMessage && !isSubmitting

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

  async function submit() {
    if (!destinationId || !canSubmit || !selectedAccountUid) return
    const submitInput = {
      from: sourceId,
      to: destinationId,
      mode: input.mode,
      signingAccountId: selectedAccountUid,
      origin: input.origin,
    }
    setIsSubmitting(true)
    try {
      await onSubmit(submitInput)
      onClose()
      onSuccess?.(submitInput)
      toast.success(modeCopy[input.mode].success)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to ${modeCopy[input.mode].action.toLowerCase()}`)
    } finally {
      setIsSubmitting(false)
    }
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
        <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button disabled={!canSubmit} onClick={submit}>
          {isSubmitting ? <Spinner /> : null}
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
  writableDocuments: WritableDocumentDestination[]
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
  writableDocuments: WritableDocumentDestination[]
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
    .map((item) => ({id: item.id, metadata: {name: item.title}}))
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
  roots: WritableDocumentDestination[]
  onSelect: (location: UnpackedHypermediaId) => void
}) {
  return (
    <LocationList emptyLabel="No writable destinations available for the selected account.">
      {roots.filter(isPublicWritableDocument).map((item) => {
        const title = item.title || (item.document ? getMetadataName(item.document.metadata) : item.id.uid)
        return <LocationRow key={item.id.id} id={item.id} title={title} onSelect={onSelect} />
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
  const {data: directory, isLoading} = useDirectory(parent, {mode: 'Children'})
  const parentLocation = parent.path?.length ? hmId(parent.uid, {path: parent.path.slice(0, -1)}) : null
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

function LocationList({children, emptyLabel}: {children: React.ReactNode; emptyLabel: string}) {
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
  const siteId = hmId(location.uid, {latest: true})
  const {data: siteResource} = useResource(siteId)
  const siteTitle = siteResource?.type === 'document' ? getMetadataName(siteResource.document.metadata) : location.uid
  const ancestorIds = useMemo(
    () => location.path?.map((_, index) => hmId(location.uid, {path: location.path?.slice(0, index + 1)})) || [],
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
  const {origin} = useUniversalAppContext()
  const {data: siteResource} = useResource(location ? hmId(location.uid, {latest: true}) : null)
  if (!location) return null
  const siteDocument = siteResource?.type === 'document' ? siteResource.document : undefined
  const siteUrl = siteDocument?.metadata.siteUrl
  if (siteUrl) return createSiteUrl({path: location.path, hostname: siteUrl})
  return createWebHMUrl(location.uid, {path: location.path, hostname: origin || DEFAULT_GATEWAY_URL})
}

function DialogError({message}: {message: string}) {
  return (
    <div className="border-destructive/30 bg-destructive/10 flex min-h-32 items-center gap-3 rounded-lg border p-4">
      <FileText className="text-destructive size-5" />
      <SizableText className="text-destructive text-sm">{message}</SizableText>
    </div>
  )
}

function canWriteLocation(
  writableDocuments: WritableDocumentDestination[],
  location: UnpackedHypermediaId,
  selectedAccountUid?: string | null,
) {
  if (!selectedAccountUid) return false
  return writableDocuments.some((document) => {
    const accountsWithWrite = document.accountsWithWrite || [selectedAccountUid]
    return isIdParentOfOrEqual(document.id, location) && accountsWithWrite.includes(selectedAccountUid)
  })
}

function getWritableRoots(writableDocuments: WritableDocumentDestination[], selectedAccountUid: string) {
  const roots = writableDocuments.filter((document) =>
    (document.accountsWithWrite || [selectedAccountUid]).includes(selectedAccountUid),
  )
  const deduped = new Map<string, WritableDocumentDestination>()
  roots.forEach((document) => {
    if (!deduped.has(document.id.id)) deduped.set(document.id.id, document)
  })
  return Array.from(deduped.values())
}

function isPublicWritableDocument(document: WritableDocumentDestination) {
  return !document.document || canUseDocumentAsDestinationParent(document.document)
}
