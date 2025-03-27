import {useMyAccountIds} from '@/models/daemon'
import {useForkDocument, useListDirectory} from '@/models/documents'
import {trpc} from '@/trpc'
import {pathNameify} from '@/utils/path'
import {useNavigate} from '@/utils/useNavigate'
import {hmId, UnpackedHypermediaId} from '@shm/shared'
import {useEntities, useEntity} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {Field} from '@shm/ui/form-fields'
import {HMIcon} from '@shm/ui/hm-icon'
import {SelectDropdown} from '@shm/ui/select-dropdown'
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
      <DialogTitle>Fork "{entity?.document?.metadata.name}"</DialogTitle>
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
                Fork
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
  const {data: directory} = useListDirectory(parentId)
  console.log({directory})
  return (
    <YStack gap="$3">
      {/* <SizableText>{JSON.stringify(directory)}</SizableText> */}
      <Field label="Branch Author Account" id="account">
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
      <Field label="Location" id="location">
        <ScrollView
          minHeight={180}
          borderWidth={1}
          borderColor="$borderColor"
          borderRadius="$4"
        >
          <YStack>
            {directory?.map((d) => {
              return <SizableText>{d.metadata.name}</SizableText>
            })}
          </YStack>
        </ScrollView>
      </Field>
      <Field label="URL Path" id="url-path">
        <Input
          id="url-path"
          value={location?.path?.at(-1) || ''}
          onChangeText={(text) => {
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

function URLPreview({location}: {location: UnpackedHypermediaId}) {
  // todo render the final URL. base on the gateway URL and the sites homeDocument siteURL
  return (
    <SizableText color="$color8" size="$2" marginVertical="$4">
      {location.id}
    </SizableText>
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
