import {
  useAbilities,
  useCreateAccount,
  useDeleteAbility,
  useLocalKeyPair,
} from '@/auth'
import {
  entityQueryPathToHmIdPath,
  HMDocument,
  hmId,
  hostnameStripProtocol,
} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {useEffect, useState} from 'react'
import {styled, Text, XStack, YStack} from 'tamagui'
import {z} from 'zod'
import {Ability, AbilityModeSchema} from './auth-abilities'
import {preparePublicKey} from './auth-utils'
import {writeAbility} from './local-db'
import {injectModels} from './models'

injectModels()

const fragmentOptionsSchema = z.object({
  requestOrigin: z.string().optional(),
  targetUid: z.string().optional(),
  mode: AbilityModeSchema.optional(),
  recursive: z.literal('true').optional(),
  expiration: z.string().optional(),
  targetPath: z.string().optional(),
})

export type AuthFragmentOptions = z.infer<typeof fragmentOptionsSchema>

export default function HMAuthPage({
  enableWebIssuing,
}: {
  enableWebIssuing: boolean
}) {
  const {
    createAccount,
    canCreateAccount,
    userKeyPair,
    content: createAccountContent,
  } = useCreateAccount()
  const userHomeDoc = useEntity(userKeyPair ? hmId('d', userKeyPair.id) : null)
  const [authMode, setAuthMode] = useState<
    | {
        mode: 'request'
        requestOrigin: string
        targetUid: string | null
        abilityMode: z.infer<typeof AbilityModeSchema>
        recursive: boolean
        expiration: number | null
        targetPath: string[] | null
      }
    | {mode: 'approved'; ability: Ability}
    | null
  >(null)
  const abilities = useAbilities()
  useEffect(() => {
    if (!window?.location) {
      return
    }
    const rawFragment = window.location.hash.slice(1)
    const params = fragmentOptionsSchema.parse(
      Object.fromEntries(new URLSearchParams(rawFragment)),
    )
    const {requestOrigin, targetUid, mode, recursive, expiration, targetPath} =
      params
    if (!requestOrigin) {
      return
    }
    setAuthMode({
      mode: 'request',
      requestOrigin,
      targetUid: targetUid || null,
      abilityMode: mode || 'all',
      recursive: recursive === 'true',
      expiration: expiration ? Number(expiration) : null,
      targetPath:
        (targetPath ? entityQueryPathToHmIdPath(targetPath) : null) || null,
    })
  }, [window.location.hash])
  if (userKeyPair && authMode?.mode === 'request') {
    const {mode, ...abilityRequest} = authMode
    return (
      <RequestAbility
        request={abilityRequest}
        onApprove={(ability) => {
          setAuthMode({mode: 'approved', ability})
        }}
      />
    )
  }
  if (userKeyPair && authMode?.mode === 'approved') {
    return <AbilityApproved ability={authMode.ability} />
  }
  if (!enableWebIssuing) {
    return <div>Web auth not configured for this host.</div>
  }
  return (
    <YStack>
      <AuthIdentity
        uid={userKeyPair?.id}
        document={userHomeDoc.data?.document}
      />
      <ManageAbilities abilities={abilities} />
      {userKeyPair || !canCreateAccount ? null : (
        <Button onPress={createAccount}>Create Account</Button>
      )}
      {createAccountContent}
    </YStack>
  )
}

function RequestAbility({
  request,
  onApprove,
}: {
  request: {
    requestOrigin: string
    targetUid: string | null
    abilityMode: z.infer<typeof AbilityModeSchema>
    recursive: boolean
    expiration: number | null
    targetPath: string[] | null
  }
  onApprove: (ability: Ability) => void
}) {
  const userKeyPair = useLocalKeyPair()
  if (!userKeyPair) {
    return null
  }
  const {
    requestOrigin,
    targetUid,
    abilityMode,
    recursive,
    expiration,
    targetPath,
  } = request
  return (
    <AuthPageSection>
      <Text>Request origin: {requestOrigin}</Text>
      <Button
        onPress={() => {
          preparePublicKey(userKeyPair.publicKey)
            .then((accountPublicKey) => {
              const ability: Omit<Ability, 'id'> = {
                accountUid: userKeyPair.id,
                accountPublicKey,
                delegateOrigin: requestOrigin,
                mode: abilityMode,
                expiration,
                recursive,
                targetPath,
                targetUid,
                identityOrigin: window.location.origin,
              }
              writeAbility(ability).then((writtenAbility) => {
                onApprove(writtenAbility)
              })
            })
            .catch((e) => {
              console.error('Error preparing public key', e)
            })
        }}
      >
        Approve Request
      </Button>
    </AuthPageSection>
  )
}

function AbilityApproved({ability}: {ability: Ability}) {
  return (
    <AuthPageSection>
      <Text>
        Ability Approved for {hostnameStripProtocol(ability.delegateOrigin)}.
        You can now close this window.
      </Text>
      <Button
        onPress={() => {
          window.close()
        }}
      >
        Close Window
      </Button>
    </AuthPageSection>
  )
}

function AuthIdentity({
  uid,
  document,
}: {
  uid: string | undefined
  document: HMDocument | null | undefined
}) {
  if (!uid) {
    return null
  }
  return (
    <AuthPageSection>
      <Text>Auth Identity: {uid}</Text>
      {document?.metadata.name && <Text>{document.metadata.name}</Text>}
    </AuthPageSection>
  )
}

function ManageAbilities({abilities}: {abilities: Ability[] | null}) {
  const deleteAbility = useDeleteAbility()
  return (
    <AuthPageSection>
      {abilities?.map((ability) => (
        <AbilityRow
          key={ability.id}
          ability={ability}
          onDelete={() => {
            deleteAbility.mutate(ability.id)
          }}
        />
      ))}
    </AuthPageSection>
  )
}

function AbilityRow({
  ability,
  onDelete,
}: {
  ability: Ability
  onDelete: () => void
}) {
  return (
    <XStack group="item">
      <Text>
        {ability.delegateOrigin} - {ability.mode} - {ability.targetUid}
      </Text>
      <Button
        opacity={0}
        $group-item-hover={{opacity: 1}}
        onPress={() => {
          onDelete()
        }}
      >
        Delete
      </Button>
    </XStack>
  )
}
const AuthPageSection = styled(YStack, {
  padding: '$4',
  borderRadius: '$4',
  borderWidth: 1,
  borderColor: '$border',
})
