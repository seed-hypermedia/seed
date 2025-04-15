import {DeviceLinkCompletion, linkDevice} from '@/device-linking'
import {injectModels} from '@/models'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {DeviceLinkSessionSchema, hmId} from '@shm/shared'
import {DeviceLinkSession} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {Spinner} from '@shm/ui/spinner'
import {base58btc} from 'multiformats/bases/base58'
import {useEffect, useState} from 'react'
import {Button, Paragraph, YStack} from 'tamagui'

injectModels()
// export async function loader({request}: LoaderFunctionArgs) {
//   const parsedRequest = parseRequest(request)
//   const code = parsedRequest.pathParts[2]
//   console.log('code', code)
//   return
// }

export default function HMDeviceLink() {
  const [error, setError] = useState<string | null>(null)
  const [completion, setCompletion] = useState<DeviceLinkCompletion | null>(
    null,
  )
  const [deviceLinkSession, setDeviceLinkSession] =
    useState<null | DeviceLinkSession>()
  useEffect(() => {
    const fragment = window.location.hash.substring(1)
    try {
      if (!fragment) {
        throw new Error('No fragment passed to /hm/device-link#FRAGMENT')
      }
      const decodedData = cborDecode(base58btc.decode(fragment))
      console.log('decodedData', decodedData)
      const session = DeviceLinkSessionSchema.parse(decodedData)
      setDeviceLinkSession(session)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  const {data: account} = useEntity(
    deviceLinkSession ? hmId('d', deviceLinkSession.accountId) : undefined,
  )

  if (error) {
    return <div>Error: {error}</div>
  }
  if (!deviceLinkSession) {
    return <Spinner />
  }

  if (completion) {
    return <div>you did it!! {JSON.stringify(completion)}</div>
  }

  const linkAccountName = account?.document?.metadata?.name || 'Unknown Account'
  return (
    <YStack>
      <Paragraph>
        HMDeviceLink {linkAccountName} to {deviceLinkSession.accountId}
      </Paragraph>
      <Button
        onPress={() => {
          if (!deviceLinkSession) {
            setError('No device link session found')
            return
          }
          linkDevice(deviceLinkSession)
            .then((completion) => {
              setCompletion(completion)
            })
            .catch((e) => {
              setError(e.message)
            })
        }}
      >
        Merge Identity
      </Button>
    </YStack>
  )
}
