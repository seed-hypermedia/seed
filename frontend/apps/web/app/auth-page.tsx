import {preparePublicKey, useCreateAccount} from '@/auth'
import {Ability, deleteAbility, getAllAbilities, writeAbility} from '@/local-db'
import {Button} from '@shm/ui/button'
import {useEffect, useState, useSyncExternalStore} from 'react'
import {Text, XStack, YStack} from 'tamagui'

let allAbilities: Ability[] | null = null
let allAbilitiesJson: string | null = null
const allAbilitiesSubscribers = new Set<() => void>()
const allAbilitiesStore = {
  subscribe: (onUpdate: () => void) => {
    allAbilitiesSubscribers.add(onUpdate)
    return () => {
      allAbilitiesSubscribers.delete(onUpdate)
    }
  },
  getSnapshot: () => allAbilities,
} as const

function useAbilities() {
  return useSyncExternalStore(
    allAbilitiesStore.subscribe,
    allAbilitiesStore.getSnapshot,
    () => null,
  )
}

function updateAbilities() {
  getAllAbilities().then((abilities) => {
    const jsonCheck = JSON.stringify(abilities)
    if (allAbilitiesJson !== jsonCheck) {
      allAbilities = abilities
      allAbilitiesJson = jsonCheck
      allAbilitiesSubscribers.forEach((onUpdate) => onUpdate())
    }
  })
}

updateAbilities()
setInterval(updateAbilities, 200)

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
  const [authMode, setAuthMode] = useState<
    | {
        mode: 'request'
        requestOrigin: string
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
    console.log('##', rawFragment)
    const params = new URLSearchParams(rawFragment)
    const requestOrigin = params.get('requestOrigin')
    console.log('requestOrigin', requestOrigin)
    if (!requestOrigin) {
      return
    }
    setAuthMode({mode: 'request', requestOrigin})
  }, [window.location.hash])

  if (userKeyPair && authMode?.mode === 'request') {
    return (
      <>
        <Text>Request origin: {authMode.requestOrigin}</Text>
        <Button
          onPress={() => {
            preparePublicKey(userKeyPair.publicKey)
              .then((accountPublicKey) => {
                const ability: Omit<Ability, 'id'> = {
                  accountUid: userKeyPair.id,
                  accountPublicKey,
                  delegateOrigin: authMode.requestOrigin,
                  mode: 'all',
                  expiration: null,
                  recursive: false,
                  targetPath: [],
                  targetUid: null,
                  identityOrigin: window.location.origin,
                }
                writeAbility(ability).then((writtenAbility) => {
                  setAuthMode({mode: 'approved', ability: writtenAbility})
                })
              })
              .catch((e) => {
                console.error('Error preparing public key', e)
              })
          }}
        >
          Approve Request
        </Button>
      </>
    )
  }
  if (userKeyPair && authMode?.mode === 'approved') {
    return (
      <>
        <Text>Approved! You can now close this window.</Text>
        <Button
          onPress={() => {
            window.close()
          }}
        >
          Close Window
        </Button>
      </>
    )
  }
  if (!enableWebIssuing) {
    return <div>Web auth not configured for this host.</div>
  }
  return (
    <YStack>
      <Text>You can issue signing abilities to other hosts.</Text>
      {abilities?.map((ability) => (
        <XStack key={ability.id}>
          <Text key={ability.delegateOrigin}>
            {ability.delegateOrigin} - {ability.mode} - {ability.targetUid}
          </Text>
          <Button
            onPress={() => {
              deleteAbility(ability.id).then(() => {
                updateAbilities()
              })
            }}
          >
            Delete
          </Button>
        </XStack>
      ))}
      {userKeyPair ? null : (
        <Button onPress={createAccount}>Create Account</Button>
      )}
      {createAccountContent}
    </YStack>
  )
}
