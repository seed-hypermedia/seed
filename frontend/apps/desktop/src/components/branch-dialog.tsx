import {useMyAccountIds} from '@/models/daemon'
import {useForkDocument, useListDirectory} from '@/models/documents'
import {useGatewayUrl} from '@/models/gateway-settings'
import {trpc} from '@/trpc'
import {pathNameify} from '@/utils/path'
import {useNavigate} from '@/utils/useNavigate'
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
import {ArrowUp} from '@tamagui/lucide-icons'
import {useEffect, useMemo, useState} from 'react'
import {Input, ScrollView, SizableText, Spinner, XStack, YStack} from 'tamagui'
import {DialogTitle} from './dialog'

export function BranchDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: UnpackedHypermediaId
}) {
  const {data: entity} = useEntity(input)
  const forkDoc = useForkDocument()
  const [account, setAccount] = useState<string | null>(null)
  const navigate = useNavigate()
  const [location, setLocation] = useState<UnpackedHypermediaId | null>(null)

  if (!entity) return <Spinner />
  return (
    <YStack>
      <DialogTitle>Branch from "{entity?.document?.metadata.name}"</DialogTitle>
      {entity ? (
        <>
          <NewLocationSelectionForm
            location={location}
            setLocation={setLocation}
            newName={entity?.document?.metadata.name || 'Untitled'}
            account={account}
            setAccount={setAccount}
          />
          <XStack gap="$2">
            <Spinner opacity={forkDoc.isLoading ? 1 : 0} />

            {location && account ? (
              <Button
                onPress={() => {
                  forkDoc
                    .mutateAsync({
                      from: input,
                      to: location,
                      signingAccountId: account,
                    })
                    .then(() => {
                      navigate({key: 'document', id: location})
                    })
                }}
              >
                Create Document Branch
              </Button>
            ) : null}
          </XStack>
        </>
      ) : (
        <Spinner />
      )}
    </YStack>
  )
}

function NewLocationSelectionForm({
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
  console.log({directory})
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
            {parentId ? (
              <LocationPreview location={parentId} setLocation={setLocation} />
            ) : null}
            {(location.path?.length || 0) > 1 ? (
              <Button
                onPress={() => {
                  setLocation(
                    hmId('d', location.uid, {
                      path: location.path?.slice(0, -1),
                    }),
                  )
                }}
                icon={ArrowUp}
                size="$2"
              />
            ) : null}
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
                          path: [...d.path, location.path?.at(-1) || ''],
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
      <Field label="URL Path" id="url-path">
        <Input
          id="url-path"
          value={location?.path?.at(-1) || ''}
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

function LocationPreview({
  location,
  setLocation,
}: {
  location: UnpackedHypermediaId
  setLocation: (location: UnpackedHypermediaId) => void
}) {
  const siteId = hmId('d', location.uid, {latest: true})
  const site = useEntity(siteId)
  const locationBreadcrumbIds = useMemo(() => {
    if (!location) return []
    return (
      location.path
        // ?.slice(0,)
        ?.map((_path, index) =>
          hmId('d', location.uid, {path: location.path?.slice(0, index + 1)}),
        ) || []
    )
  }, [location.uid, location.path])
  const newPathTerm = location.path?.at(-1) || ''
  console.log('~~ ', locationBreadcrumbIds)
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
          setLocation(hmId('d', location.uid))
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
                  path: [...path, newPathTerm],
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
