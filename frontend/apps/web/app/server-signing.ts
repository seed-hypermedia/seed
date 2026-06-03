import type {HMSigner} from '@seed-hypermedia/client/hm-types'
import {base58btc} from 'multiformats/bases/base58'
import {grpcClient} from './client.server'

async function listSortedServerKeys() {
  const keys = await grpcClient.daemon.listKeys({})
  return [...(keys.keys || [])].filter((key) => key.accountId).sort((a, b) => a.accountId.localeCompare(b.accountId))
}

async function getOrCreateServerSignerAccountUidUncached(): Promise<string> {
  const existingKeys = await listSortedServerKeys()
  const existingSignerAccountUid = existingKeys[0]?.accountId
  if (existingSignerAccountUid) {
    return existingSignerAccountUid
  }

  console.log('No server signing keys found; creating one')
  const mnemonicResponse = await grpcClient.daemon.genMnemonic({})
  if (!mnemonicResponse.mnemonic.length) {
    throw new Error('Daemon returned no mnemonic while creating a web signing key')
  }

  try {
    const registration = await grpcClient.daemon.registerKey({
      mnemonic: mnemonicResponse.mnemonic,
    })
    const createdSignerAccountUid = registration.accountId || registration.publicKey
    if (createdSignerAccountUid) {
      return createdSignerAccountUid
    }
  } catch (error) {
    const concurrentKeys = await listSortedServerKeys()
    const concurrentSignerAccountUid = concurrentKeys[0]?.accountId
    if (concurrentSignerAccountUid) {
      return concurrentSignerAccountUid
    }
    throw error
  }

  const createdKeys = await listSortedServerKeys()
  const createdSignerAccountUid = createdKeys[0]?.accountId
  if (!createdSignerAccountUid) {
    throw new Error('Daemon did not expose a signing key after registration')
  }

  return createdSignerAccountUid
}

let pendingServerSignerAccountUid: Promise<string> | null = null

/** Ensures the web server daemon has at least one signing key and returns its account UID. */
export async function getOrCreateServerSignerAccountUid(): Promise<string> {
  if (!pendingServerSignerAccountUid) {
    pendingServerSignerAccountUid = getOrCreateServerSignerAccountUidUncached().finally(() => {
      pendingServerSignerAccountUid = null
    })
  }

  return pendingServerSignerAccountUid
}

/** Returns a daemon-backed signer for an existing server key account UID. */
export async function getServerSigner(accountUid: string): Promise<HMSigner> {
  const keys = await listSortedServerKeys()
  const key = keys.find((candidate) => candidate.accountId === accountUid)
  if (!key) {
    throw new Error(`Server signing key not found for account ${accountUid}`)
  }

  return {
    getPublicKey: async () => base58btc.decode(key.accountId),
    sign: async (data: Uint8Array) => {
      const result = await grpcClient.daemon.signData({
        signingKeyName: key.name,
        data,
      })
      return result.signature
    },
  }
}
