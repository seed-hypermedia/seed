import {DeviceLinkSession} from '@shm/shared/hm-types'
import {generateAndStoreKeyPair} from './auth'
import {preparePublicKey} from './auth-utils'
import {getStoredLocalKeys} from './local-db'

export type DeviceLinkCompletion = {}

export async function linkDevice(
  session: DeviceLinkSession,
): Promise<DeviceLinkCompletion> {
  console.log('Will link device', session)
  let keyPair = await getStoredLocalKeys()

  if (!keyPair) {
    console.log('No key pair found, creating one')
    keyPair = await generateAndStoreKeyPair()
  }

  console.log('Key pair for session:', keyPair)
  const publicKey = await preparePublicKey(keyPair.publicKey)
  console.log('Public key for session:', publicKey)
  return {}
}
