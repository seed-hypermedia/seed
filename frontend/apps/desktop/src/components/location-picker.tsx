import {useMyAccountIds} from '@/models/daemon'
import {useListDirectory} from '@/models/documents'
import {useGatewayUrl} from '@/models/gateway-settings'
import {trpc} from '@/trpc'
import {pathNameify} from '@/utils/path'
import {
  createSiteUrl,
  createWebHMUrl,
  hmId,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useEntities, useEntity} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {Field} from '@shm/ui/form-fields'
import {HMIcon} from '@shm/ui/hm-icon'
import {SelectDropdown} from '@shm/ui/select-dropdown'
import {Tooltip} from '@shm/ui/tooltip'
import {Search, Undo2} from '@tamagui/lucide-icons'
import {useEffect, useMemo, useState} from 'react'
import {Input, ScrollView, SizableText, XStack, YStack} from 'tamagui'

export function LocationPicker({
  location,
  setLocation,
  account,
  setAccount,
  newName,
}: {
  location: UnpackedHypermediaId | null
  setLocation: (location: UnpackedHypermediaId | null) => void
  account: string | null
  setAccount: (account: string | null) => void
  newName: string
}) {
  const defaultAccountId = useDefaultAccountId()
  const {data: myAccountIds} = useMyAccountIds()
  const accts = useEntities(myAccountIds?.map((id) => hmId('d', id)) || [])

  useEffect(() => {
    if (!location && defaultAccountId) {
      setLocation(
        hmId('d', defaultAccountId, {
          path: [pathNameify(newName)],
        }),
      )
    }
  }, [location, defaultAccountId])
  useEffect(() => {
    if (!account && defaultAccountId) {
      setAccount(defaultAccountId)
    }
  }, [account, defaultAccountId])
  const parentId = useParentId(location)
  const {data: directory} = useListDirectory(parentId, {mode: 'Children'})
  const newUrlPath = location?.path?.at(-1) || ''
  return (
    <YStack gap="$3" marginVertical="$4">
      {/* <SizableText>{JSON.stringify(directory)}</SizableText> */}
      <Field label="Author Account" id="account">
        {account && (
          <SelectDropdown
            value={account}
            options={accts
              .map((a) => {
                const id = a.data?.id
                if (!id) return null
                return {
                  label: a.data?.document?.metadata.name || '',
                  icon: (
                    <HMIcon
                      size={24}
                      id={id}
                      metadata={a.data?.document?.metadata}
                    />
                  ),
                  value: id.uid,
                }
              })
              .filter((a) => !!a)}
            onValue={setAccount}
          />
        )}
      </Field>
      {location ? (
        <Field label="Location" id="location">
          <XStack jc="space-between" ai="center">
            {location ? (
              <LocationPreview location={location} setLocation={setLocation} />
            ) : null}
            {(location.path?.length || 0) > 1 ? (
              <Tooltip content="Move location out to here">
                <Button
                  onPress={() => {
                    const newPath = [
                      ...(location.path?.slice(0, -2) || []),
                      newUrlPath,
                    ]
                    setLocation(hmId('d', location.uid, {path: newPath}))
                  }}
                  icon={Undo2}
                  size="$2"
                />
              </Tooltip>
            ) : null}
            <LocationSearch location={location} setLocation={setLocation} />
          </XStack>
          <ScrollView
            height={200}
            borderWidth={1}
            borderColor="$borderColor"
            borderRadius="$4"
          >
            <YStack>
              {directory?.map((d, index) => {
                return (
                  <Button
                    onPress={() => {
                      setLocation(
                        hmId('d', location.uid, {
                          path: [...d.path, newUrlPath],
                        }),
                      )
                    }}
                  >
                    <XStack jc="space-between" f={1}>
                      <SizableText>{d.metadata.name}</SizableText>
                      <SizableText color="$color8">
                        {d.path?.at(-1)}
                      </SizableText>
                    </XStack>
                  </Button>
                )
              })}
            </YStack>
          </ScrollView>
        </Field>
      ) : null}
      <Field label="New URL Path" id="url-path">
        <Input
          id="url-path"
          value={newUrlPath}
          onChangeText={(text: string) => {
            if (!location) return
            setLocation(
              hmId('d', location?.uid, {
                path: [...(location?.path?.slice(0, -1) || []), text],
              }),
            )
          }}
        />
      </Field>
      {location && <URLPreview location={location} />}
    </YStack>
  )
}

function LocationSearch({
  location,
  setLocation,
}: {
  location: UnpackedHypermediaId
  setLocation: (location: UnpackedHypermediaId) => void
}) {
  const myAccountIds = useMyAccountIds()
  const [search, setSearch] = useState('')
  return <Button icon={Search} size="$2" />
}

function LocationPreview({
  location,
  setLocation,
}: {
  location: UnpackedHypermediaId
  setLocation: (location: UnpackedHypermediaId) => void
}) {
  const parentId = useParentId(location)
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
    <XStack paddingVertical="$2" ai="center" gap="$3">
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

function URLPreview({location}: {location: UnpackedHypermediaId}) {
  const url = useDocumentUrl(location)
  return (
    <YStack>
      <SizableText color="$color10" size="$2">
        Branch Destination URL
      </SizableText>
      <SizableText color="$blue11" size="$3">
        {url}
      </SizableText>
    </YStack>
  )
}

function useDefaultAccountId(): string | null {
  const recentSigners = trpc.recentSigners.get.useQuery()
  const {data: myAccountIds} = useMyAccountIds()

  if (!myAccountIds?.length) return null
  const myAccounts = new Set(myAccountIds)

  const recentSigner = recentSigners.data?.recentSigners.find((signer) =>
    myAccounts.has(signer),
  )
  if (recentSigner) return recentSigner
  return myAccountIds[0] || null
}

function useParentId(id: UnpackedHypermediaId | null) {
  return useMemo(() => {
    if (!id) return null
    return hmId('d', id.uid, {
      path: id.path?.slice(0, -1),
    })
  }, [id?.uid, id?.path?.slice(0, -1).join('/')])
}
