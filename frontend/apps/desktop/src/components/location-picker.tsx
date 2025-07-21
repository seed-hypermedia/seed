import {
  HMWritableDocument,
  roleCanWrite,
  useAllDocumentCapabilities,
  useSelectedAccountWritableDocuments,
} from '@/models/access-control'
import {useMyAccountIds} from '@/models/daemon'
import {useListDirectory} from '@/models/documents'
import {useGatewayUrl} from '@/models/gateway-settings'
import {trpc} from '@/trpc'
import {pathNameify} from '@/utils/path'
import {
  createSiteUrl,
  createWebHMUrl,
  getParent,
  hmId,
  hmIdPathToEntityQueryPath,
  HMMetadataPayload,
  isIdParentOfOrEqual,
  UnpackedHypermediaId,
  useSearch,
} from '@shm/shared'
import {useResource, useResources} from '@shm/shared/models/entity'
import {validatePath} from '@shm/shared/utils/document-path'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Field} from '@shm/ui/form-fields'
import {HMIcon} from '@shm/ui/hm-icon'
import {AlertCircle, Search, Undo2} from '@shm/ui/icons'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {cn} from '@shm/ui/utils'
import {useEffect, useMemo, useState} from 'react'

export function LocationPicker({
  location,
  setLocation,
  account,
  newName,
  actionLabel,
  onAvailable,
}: {
  location: UnpackedHypermediaId | null
  setLocation: (location: UnpackedHypermediaId | null) => void
  account: string
  newName: string
  actionLabel: string
  onAvailable?: (isAvailable: boolean) => void
}) {
  const writableDocuments = useSelectedAccountWritableDocuments()
  const newUrlPath = location?.path?.at(-1) || ''

  function handleSetLocation(location: UnpackedHypermediaId) {
    // make sure the account can write to this location. if not, change the account to the account who can.
    const allAcctsWithWrite = writableDocuments.filter((d) => {
      if (isIdParentOfOrEqual(d.entity.id, location)) return true
    })
    const thisAccountWithWrite =
      account &&
      allAcctsWithWrite.find((d) => d.accountsWithWrite.includes(account))
    if (thisAccountWithWrite) {
      setLocation(location)
    } else {
      toast.error('You are not allowed to write to this location')
    }
  }

  useEffect(() => {
    if (!location && account) {
      const id = hmId(account, {
        path: [pathNameify(newName)],
      })
      setLocation(id)
    }
  }, [location, account])

  const newDestinationAlreadyResource = useResource(location)
  const newDestinationAlreadyDocument =
    newDestinationAlreadyResource.data?.type === 'document'
      ? newDestinationAlreadyResource.data.document
      : undefined
  useEffect(() => {
    if (onAvailable) {
      onAvailable(!newDestinationAlreadyDocument)
    }
  }, [!newDestinationAlreadyDocument])
  const parentId = useParentId(location)
  const {data: directory} = useListDirectory(parentId, {mode: 'Children'})
  return (
    <div className="my-4 flex flex-col gap-3">
      {location ? (
        <Field label={`${capitalize(actionLabel)} to Location`} id="location">
          <div className="flex flex-wrap items-center justify-between">
            {location ? (
              <LocationPreview
                location={location}
                setLocation={handleSetLocation}
              />
            ) : null}
            <div className="flex gap-2">
              {(location.path?.length || 0) > 1 ? (
                <Tooltip content={`Location to ${actionLabel} this document`}>
                  <Button
                    onClick={() => {
                      const newPath = [
                        ...(location.path?.slice(0, -2) || []),
                        newUrlPath,
                      ]
                      handleSetLocation(hmId(location.uid, {path: newPath}))
                    }}
                    size="sm"
                  >
                    <Undo2 className="size-4" />
                  </Button>
                </Tooltip>
              ) : null}
              <LocationSearch
                writableDocuments={writableDocuments}
                location={location}
                setLocation={handleSetLocation}
              />
            </div>
          </div>
          <ScrollArea className="border-border h-40 rounded-md border">
            <div className="flex flex-col pl-2.5">
              {directory?.map((d, index) => {
                return (
                  <Button
                    key={index}
                    onClick={() => {
                      handleSetLocation(
                        hmId(location.uid, {
                          path: [...d.path, newUrlPath],
                        }),
                      )
                    }}
                    variant="ghost"
                    className="h-auto min-h-[40px] justify-start"
                  >
                    <div className="flex flex-1 flex-wrap justify-between">
                      <SizableText>{d.metadata.name}</SizableText>
                      <SizableText className="text-muted-foreground text-right">
                        {d.path?.at(-1)}
                      </SizableText>
                    </div>
                  </Button>
                )
              })}
            </div>
          </ScrollArea>
        </Field>
      ) : null}
      <Field label="New URL Path" id="url-path">
        <Input
          id="url-path"
          value={newUrlPath}
          onChange={(e) => {
            const text = e.target.value
            if (!location) return
            handleSetLocation(
              hmId(location?.uid, {
                path: [
                  ...(location?.path?.slice(0, -1) || []),
                  pathNameify(text),
                ],
              }),
            )
          }}
        />
      </Field>
      {location && (
        <URLPreview
          location={location}
          isUnavailable={!!newDestinationAlreadyDocument}
          actionLabel={actionLabel}
        />
      )}
    </div>
  )
}

function LocationSearch({
  writableDocuments,
  location,
  setLocation,
}: {
  writableDocuments: HMWritableDocument[]
  location: UnpackedHypermediaId
  setLocation: (location: UnpackedHypermediaId) => void
}) {
  const popover = usePopoverState()
  return (
    <Popover {...popover}>
      <PopoverTrigger className="no-window-drag">
        <Search className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="p-2">
        <SearchContent
          writableDocuments={writableDocuments}
          onLocationSelected={(newParent) => {
            popover.onOpenChange(false)
            setLocation(
              hmId(newParent.uid, {
                path: [...(newParent.path || []), location.path?.at(-1) || ''],
              }),
            )
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
function SearchContent({
  writableDocuments,
  onLocationSelected,
}: {
  writableDocuments: HMWritableDocument[]
  onLocationSelected: (location: UnpackedHypermediaId) => void
}) {
  const [searchQ, setSearchQ] = useState('')
  const search = useSearch(searchQ)
  let searchedLocations: HMMetadataPayload[] = []
  if (searchQ === '') {
    searchedLocations = writableDocuments
      .filter((d) => !d.entity.id.path?.length)
      .map((d) => ({
        id: d.entity.id,
        metadata: d.entity.document?.metadata || null,
      }))
  } else {
    searchedLocations =
      search.data?.entities
        .filter((d) => {
          return !!writableDocuments.find((writable) =>
            isIdParentOfOrEqual(writable.entity.id, d.id),
          )
        })
        .map((d) => ({
          id: d.id,
          metadata: {name: d.title},
        })) || []
  }
  return (
    <div className="flex flex-col">
      <div className={cn('relative', searchedLocations.length && 'mb-2')}>
        <div className="absolute top-[11px] left-3">
          <Search className="size-3" />
        </div>
        <Input
          className="pl-7"
          value={searchQ}
          onChange={(e) => {
            const text = e.target.value
            setSearchQ(text)
          }}
          placeholder="Find Locations..."
        />
      </div>
      {searchedLocations.map((d) => {
        return (
          <Button
            key={d.id.id}
            onClick={() => {
              onLocationSelected(d.id)
            }}
            variant="ghost"
            className="justify-start px-2"
          >
            <div className="flex flex-1 items-center justify-start gap-2">
              <HMIcon id={d.id} metadata={d.metadata} size={24} />
              <SizableText>{d.metadata?.name}</SizableText>
            </div>
          </Button>
        )
      })}
    </div>
  )
}

function LocationPreview({
  location,
  setLocation,
}: {
  location: UnpackedHypermediaId
  setLocation: (location: UnpackedHypermediaId) => void
}) {
  const newUrlPath = location?.path?.at(-1) || ''
  const siteId = hmId(location.uid, {latest: true})
  const siteResource = useResource(siteId)
  const siteDocument =
    siteResource.data?.type === 'document'
      ? siteResource.data.document
      : undefined
  const locationBreadcrumbIds = useMemo(() => {
    if (!location) return []
    return (
      location.path
        ?.slice(0, -1)
        ?.map((_path, index) =>
          hmId(location.uid, {path: location.path?.slice(0, index + 1)}),
        ) || []
    )
  }, [location.uid, location.path])
  const locationBreadcrumbs = useResources(locationBreadcrumbIds)
  return (
    <div className="flex max-w-full flex-wrap items-center gap-3 py-2">
      <HMIcon id={siteId} metadata={siteDocument?.metadata} />
      <SizableText
        weight="bold"
        className="hover:underline"
        onClick={() => {
          setLocation(hmId(location.uid, {path: [newUrlPath]}))
        }}
      >
        {siteDocument?.metadata.name}
      </SizableText>
      {locationBreadcrumbs.map((b, index) => {
        return (
          <SizableText
            key={index}
            className="hover:underline"
            onClick={() => {
              const path = b.data?.id?.path || []
              setLocation(
                hmId(location?.uid, {
                  path: [...path, newUrlPath],
                }),
              )
            }}
          >
            {b.data?.type === 'document' ? b.data.document?.metadata.name : ''}
          </SizableText>
        )
      })}
    </div>
  )
}

function useDocumentUrl(location: UnpackedHypermediaId) {
  const gatewayUrl = useGatewayUrl()
  const {data: siteResource} = useResource(hmId(location.uid, {latest: true}))
  const siteDocument =
    siteResource?.type === 'document' ? siteResource.document : undefined
  if (!siteDocument || !gatewayUrl.data) return null
  const siteUrl = siteDocument.metadata.siteUrl
  if (siteUrl) {
    return createSiteUrl({
      path: location.path,
      hostname: siteUrl,
    })
  }
  const url = createWebHMUrl(location.uid, {
    path: location.path,
    hostname: gatewayUrl.data,
  })
  return url
}

function URLPreview({
  location,
  isUnavailable,
  actionLabel,
}: {
  location: UnpackedHypermediaId
  isUnavailable?: boolean
  actionLabel: string
}) {
  const url = useDocumentUrl(location)
  const pathInvalid = useMemo(
    () => location && validatePath(hmIdPathToEntityQueryPath(location.path)),
    [location?.path],
  )
  let tooltipContent = `This will be the URL after you ${actionLabel}`
  if (isUnavailable) {
    tooltipContent = 'This location is unavailable'
  } else if (pathInvalid) {
    tooltipContent = pathInvalid.error
  }
  let extraLabel = ''
  if (isUnavailable) {
    extraLabel = ' (Unavailable)'
  } else if (pathInvalid) {
    extraLabel = ` (Not Allowed)`
  }
  const isError = isUnavailable || pathInvalid
  return (
    <Tooltip content={tooltipContent}>
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <SizableText
            color={isError ? '$red11' : '$color10'}
            fontWeight={isError ? 'bold' : 'normal'}
            size="$2"
          >
            Branch Destination URL{extraLabel}
          </SizableText>
          {isError ? (
            <AlertCircle className="color-destructive size-3" />
          ) : null}
        </div>
        <SizableText
          size="sm"
          className={cn(
            'break-all',
            isError ? 'text-destructive' : 'text-blue-500',
          )}
        >
          {url}
        </SizableText>
      </div>
    </Tooltip>
  )
}

function useDefaultAccountId(
  allowedAccounts?: string[],
  defaultLocation?: UnpackedHypermediaId | null,
): string | null {
  const recentSigners = trpc.recentSigners.get.useQuery()
  const {data: myAccountIds} = useMyAccountIds()
  const parentLocation = getParent(defaultLocation)
  const allDocumentCapabilities = useAllDocumentCapabilities(
    parentLocation || undefined,
  )
  if (!myAccountIds?.length) return null
  const myAccounts = new Set(myAccountIds)

  const allowedAccountsSet = allowedAccounts
    ? new Set(allowedAccounts)
    : myAccounts
  const filteredAccounts = myAccountIds.filter((account) =>
    allowedAccountsSet ? allowedAccountsSet.has(account) : true,
  )
  if (!allDocumentCapabilities.data) return null
  const writableCaps = allDocumentCapabilities.data?.filter((cap) =>
    roleCanWrite(cap.role),
  )
  if (defaultLocation && writableCaps?.length) {
    const acctsWithCapsOfLocation: Set<string> = new Set(
      writableCaps.map((cap) => cap.accountUid),
    )
    if (acctsWithCapsOfLocation.size) {
      const recentSigner = recentSigners.data?.recentSigners.find((signer) =>
        acctsWithCapsOfLocation.has(signer),
      )
      return recentSigner || writableCaps[0]?.accountUid
    }
  }
  const recentSigner = recentSigners.data?.recentSigners.find((signer) =>
    filteredAccounts.includes(signer),
  )
  if (recentSigner) return recentSigner
  return filteredAccounts[0] || null
}

function useParentId(id: UnpackedHypermediaId | null) {
  return useMemo(() => {
    if (!id) return null
    return hmId(id.uid, {
      path: id.path?.slice(0, -1),
    })
  }, [id?.uid, id?.path?.slice(0, -1).join('/')])
}

function capitalize(word: string) {
  if (!word) return ''
  return word[0].toUpperCase() + word.slice(1)
}
