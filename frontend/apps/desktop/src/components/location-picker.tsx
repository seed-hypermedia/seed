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
import {useEntities, useEntity} from '@shm/shared/models/entity'
import {validatePath} from '@shm/shared/utils/document-path'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Field} from '@shm/ui/form-fields'
import {HMIcon} from '@shm/ui/hm-icon'
import {AlertCircle, Search, Undo2} from '@shm/ui/icons'
import {Button} from '@shm/ui/legacy/button'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {useEffect, useMemo, useState} from 'react'
import {Input, Popover, SizableText, View, XStack, YStack} from 'tamagui'

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
      const id = hmId('d', account, {
        path: [pathNameify(newName)],
      })
      setLocation(id)
    }
  }, [location, account])

  const newDestinationAlreadyDocument = useEntity(location)
  useEffect(() => {
    if (onAvailable) {
      onAvailable(!newDestinationAlreadyDocument?.data?.document)
    }
  }, [!newDestinationAlreadyDocument?.data?.document])
  const parentId = useParentId(location)
  const {data: directory} = useListDirectory(parentId, {mode: 'Children'})
  return (
    <YStack gap="$3" marginVertical="$4">
      {location ? (
        <Field label={`${capitalize(actionLabel)} to Location`} id="location">
          <XStack jc="space-between" ai="center" flexWrap="wrap">
            {location ? (
              <LocationPreview
                location={location}
                setLocation={handleSetLocation}
              />
            ) : null}
            <XStack gap="$2">
              {(location.path?.length || 0) > 1 ? (
                <Tooltip content={`Location to ${actionLabel} this document`}>
                  <Button
                    onPress={() => {
                      const newPath = [
                        ...(location.path?.slice(0, -2) || []),
                        newUrlPath,
                      ]
                      handleSetLocation(
                        hmId('d', location.uid, {path: newPath}),
                      )
                    }}
                    icon={<Undo2 className="size-4" />}
                    size="$2"
                  />
                </Tooltip>
              ) : null}
              <LocationSearch
                writableDocuments={writableDocuments}
                location={location}
                setLocation={handleSetLocation}
              />
            </XStack>
          </XStack>
          <ScrollArea className="border-border h-40 rounded-md border">
            <YStack className="pl-2.5">
              {directory?.map((d, index) => {
                return (
                  <Button
                    onPress={() => {
                      handleSetLocation(
                        hmId('d', location.uid, {
                          path: [...d.path, newUrlPath],
                        }),
                      )
                    }}
                    h="auto"
                    minHeight={40}
                  >
                    <XStack jc="space-between" f={1} flexWrap="wrap">
                      <SizableText numberOfLines={1}>
                        {d.metadata.name}
                      </SizableText>
                      <SizableText
                        numberOfLines={1}
                        color="$color8"
                        textAlign="right"
                      >
                        {d.path?.at(-1)}
                      </SizableText>
                    </XStack>
                  </Button>
                )
              })}
            </YStack>
          </ScrollArea>
        </Field>
      ) : null}
      <Field label="New URL Path" id="url-path">
        <Input
          id="url-path"
          value={newUrlPath}
          onChangeText={(text: string) => {
            if (!location) return
            handleSetLocation(
              hmId('d', location?.uid, {
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
          isUnavailable={!!newDestinationAlreadyDocument?.data?.document}
          actionLabel={actionLabel}
        />
      )}
    </YStack>
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
      <Popover.Trigger className="no-window-drag">
        <Button icon={<Search className="size-4" />} size="$2" />
      </Popover.Trigger>
      <Popover.Content bg="$backgroundStrong">
        <Popover.Arrow borderWidth={1} borderColor="$borderColor" />
        <SearchContent
          writableDocuments={writableDocuments}
          onLocationSelected={(newParent) => {
            popover.onOpenChange(false)
            setLocation(
              hmId('d', newParent.uid, {
                path: [...(newParent.path || []), location.path?.at(-1) || ''],
              }),
            )
          }}
        />
      </Popover.Content>
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
      .filter((d) => d.entity.id.latest)
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
        .filter((d) => d.id.latest)
        .map((d) => ({
          id: d.id,
          metadata: {name: d.title},
        })) || []
  }
  return (
    <YStack>
      <View marginBottom="$2">
        <div className="absolute top-[11px] left-3">
          <Search className="size-3" />
        </div>
        <Input
          paddingLeft="$7"
          value={searchQ}
          onChangeText={setSearchQ}
          placeholder="Find Locations..."
        />
      </View>
      {searchedLocations.map((d) => {
        return (
          <Button
            onPress={() => {
              onLocationSelected(d.id)
            }}
            backgroundColor="$colorTransparent"
            paddingHorizontal="$2"
          >
            <XStack gap="$2" ai="center" f={1} jc="flex-start">
              <HMIcon id={d.id} metadata={d.metadata} size={24} />
              <SizableText>{d.metadata?.name}</SizableText>
            </XStack>
          </Button>
        )
      })}
    </YStack>
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
  const siteId = hmId('d', location.uid, {latest: true})
  const site = useEntity(siteId)
  const locationBreadcrumbIds = useMemo(() => {
    if (!location) return []
    return (
      location.path
        ?.slice(0, -1)
        ?.map((_path, index) =>
          hmId('d', location.uid, {path: location.path?.slice(0, index + 1)}),
        ) || []
    )
  }, [location.uid, location.path])
  const locationBreadcrumbs = useEntities(locationBreadcrumbIds)
  return (
    <XStack
      paddingVertical="$2"
      ai="center"
      gap="$3"
      flexWrap="wrap"
      maxWidth="100%"
    >
      <HMIcon id={siteId} metadata={site?.data?.document?.metadata} />
      <SizableText
        fontWeight="bold"
        hoverStyle={{
          textDecorationLine: 'underline',
        }}
        onPress={() => {
          setLocation(hmId('d', location.uid, {path: [newUrlPath]}))
        }}
      >
        {site?.data?.document?.metadata.name}
      </SizableText>
      {locationBreadcrumbs.map((b, index) => {
        return (
          <SizableText
            hoverStyle={{
              textDecorationLine: 'underline',
            }}
            onPress={() => {
              const path = b.data?.id?.path || []
              setLocation(
                hmId('d', location?.uid, {
                  path: [...path, newUrlPath],
                }),
              )
            }}
          >
            {b.data?.document?.metadata.name}
          </SizableText>
        )
      })}
      {/* <SizableText>{location.path?.at(-1) || ''}</SizableText> */}
    </XStack>
  )
}

function useDocumentUrl(location: UnpackedHypermediaId) {
  const gatewayUrl = useGatewayUrl()
  const {data: site} = useEntity(hmId('d', location.uid, {latest: true}))
  if (!site || !gatewayUrl.data) return null
  const siteUrl = site.document?.metadata.siteUrl
  if (siteUrl) {
    return createSiteUrl({
      path: location.path,
      hostname: siteUrl,
    })
  }
  const url = createWebHMUrl(location.type, location.uid, {
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
      <YStack>
        <XStack ai="center" gap="$2">
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
        </XStack>
        <SizableText color={isError ? '$red11' : '$blue11'} size="$3">
          {url}
        </SizableText>
      </YStack>
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
    return hmId('d', id.uid, {
      path: id.path?.slice(0, -1),
    })
  }, [id?.uid, id?.path?.slice(0, -1).join('/')])
}

function capitalize(word: string) {
  if (!word) return ''
  return word[0].toUpperCase() + word.slice(1)
}
