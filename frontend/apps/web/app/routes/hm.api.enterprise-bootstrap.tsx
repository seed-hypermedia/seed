import {grpcClient} from '@/client.server'
import {OWNER_KEY_NAME, bearerMatches, homeDocumentOps, seedFromMnemonic} from '@/enterprise-bootstrap.server'
import {parseRequest} from '@/request'
import {getConfig, writeConfig} from '@/site-config.server'
import type {ActionFunction, LoaderFunction} from '@remix-run/node'
import {json} from '@remix-run/node'
import {createDocumentBlobs, type PrincipalSigner} from '@seed-hypermedia/client'
import * as keyfile from '@seed-hypermedia/client/keyfile'
import {SITE_BASE_URL} from '@shm/shared/constants'
import {base58btc} from 'multiformats/bases/base58'
import {z} from 'zod'

/**
 * First-deploy bootstrap of an enterprise node: creates the organization's
 * space on this daemon and registers the site to it, in one call from the
 * deploy script. Authorized by the vault admin secret the script already holds.
 *
 * The space's root key is minted in the daemon keystore from a mnemonic that
 * exists only for the duration of this request. What leaves is the standard
 * `.hmkey.json` export of that key, so the operator can import it in the vault,
 * the desktop app or `seed-cli` and hold the space's root themselves.
 */
const bootstrapSchema = z.object({
  /** Display name of the space; defaults to the site's hostname. */
  name: z.string().trim().min(1).max(200).optional(),
  /** Encrypts the exported key file; plaintext when omitted. */
  ownerPassword: z.string().min(1).optional(),
})

export type EnterpriseBootstrapResponse = {
  accountUid: string
  name: string
  keyFile: keyfile.Payload
  keyFileName: string
}

/**
 * Registers the mnemonic under the owner label. A label left behind by an
 * earlier attempt that failed later on cannot be reused, so the account id
 * disambiguates; the mnemonic is never retried with a different key.
 */
async function registerOwnerKey(mnemonic: string[], accountUid: string): Promise<string> {
  const existing = await grpcClient.daemon.listKeys({})
  const taken = new Set((existing.keys || []).map((key) => key.name))
  const name = taken.has(OWNER_KEY_NAME) ? `${OWNER_KEY_NAME}-${accountUid.slice(-8)}` : OWNER_KEY_NAME
  const registration = await grpcClient.daemon.registerKey({mnemonic, name})
  const registered = registration.accountId || registration.publicKey
  if (registered !== accountUid) {
    throw new Error(`Daemon registered ${registered} for a mnemonic the web app derived as ${accountUid}`)
  }
  return name
}

export const action: ActionFunction = async ({request}) => {
  if (request.method !== 'POST') return json({message: 'Method not allowed'}, {status: 405})
  const secret = process.env.SEED_VAULT_ADMIN_SECRET
  if (!secret) return json({message: 'Not found'}, {status: 404})
  if (!bearerMatches(request.headers.get('Authorization'), secret)) {
    return json({message: 'Unauthorized'}, {status: 401})
  }
  const {hostname} = parseRequest(request)
  try {
    const body = (await request.text()).trim()
    const input = bootstrapSchema.parse(body ? JSON.parse(body) : {})
    const config = await getConfig(hostname)
    if (!config) throw new Error(`No config defined for ${hostname}`)
    if (config.registeredAccountUid) {
      return json({message: 'This site is already registered', accountUid: config.registeredAccountUid}, {status: 409})
    }
    const name = input.name || hostname

    const {mnemonic} = await grpcClient.daemon.genMnemonic({})
    if (!mnemonic?.length) throw new Error('Daemon returned no mnemonic')
    const seed = seedFromMnemonic(mnemonic)
    const accountUid = keyfile.principalStringFromSeed(seed)
    const keyName = await registerOwnerKey(mnemonic, accountUid)

    // The daemon signs; the seed is only held here to export it.
    const signer: PrincipalSigner = {
      principal: base58btc.decode(accountUid),
      sign: async (data) => {
        const result = await grpcClient.daemon.signData({signingKeyName: keyName, data: new Uint8Array(data)})
        return new Uint8Array(result.signature)
      },
    }
    const home = await createDocumentBlobs(signer, {
      space: accountUid,
      path: '',
      ops: homeDocumentOps({name, siteUrl: SITE_BASE_URL}),
    })
    await grpcClient.daemon.storeBlobs({blobs: home.blobs.map((blob) => ({cid: blob.cid, data: blob.data}))})

    // Register the site to the space it now hosts: the same record
    // /hm/api/register writes, minus the dial, since the source peer is us.
    const daemonInfo = await grpcClient.daemon.getInfo({})
    await writeConfig(hostname, {registeredAccountUid: accountUid, sourcePeerId: daemonInfo.peerId})

    const keyFile = await keyfile.create({
      publicKey: accountUid,
      key: seed,
      password: input.ownerPassword,
      profile: {name},
    })
    const response: EnterpriseBootstrapResponse = {
      accountUid,
      name,
      keyFile,
      keyFileName: `${accountUid}.hmkey.json`,
    }
    return json(response)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('enterprise bootstrap failed:', message)
    return json({message}, {status: 500})
  }
}

export const loader: LoaderFunction = async () => json({message: 'Method not allowed'}, {status: 405})
