import {grpcClient} from '@/client.server'
import {OWNER_KEY_NAME, bearerMatches, changeBase, siteUrlOps} from '@/enterprise-bootstrap.server'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config.server'
import type {ActionFunction, LoaderFunction} from '@remix-run/node'
import {json} from '@remix-run/node'
import {createChange, createChangeOps, createVersionRef, type PrincipalSigner} from '@seed-hypermedia/client'
import {BIG_INT, SITE_BASE_URL} from '@shm/shared/constants'
import {CID} from 'multiformats'
import {base58btc} from 'multiformats/bases/base58'

/**
 * After the site's hostname changed (`seed-deploy set-hostname`), the
 * organization's home document still names the old address in `siteUrl`.
 * This republishes it with `siteUrl` = this site's base URL: one metadata
 * change on top of the current heads, signed by the daemon-held owner key
 * the bootstrap registered, and a Version Ref in the document's current
 * generation. The body is not touched. Authorized by the vault admin secret,
 * like the bootstrap.
 */
export type EnterpriseSiteUrlResponse = {
  accountUid: string
  siteUrl: string
  /** False when the home document already carried this siteUrl; nothing was published. */
  changed: boolean
  previousSiteUrl: string | null
}

/** The daemon key that signs for the space: the bootstrap's owner key, found by account. */
async function ownerKeyNameFor(accountUid: string): Promise<string> {
  const {keys} = await grpcClient.daemon.listKeys({})
  const owned = (keys || []).filter((key) => key.accountId === accountUid || key.publicKey === accountUid)
  const key = owned.find((candidate) => candidate.name.startsWith(OWNER_KEY_NAME)) ?? owned[0]
  if (!key) throw new Error(`The daemon holds no key for the space ${accountUid}; cannot sign its home document`)
  return key.name
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
    const config = await getConfig(hostname)
    if (!config) throw new Error(`No config defined for ${hostname}`)
    const accountUid = config.registeredAccountUid
    if (!accountUid) {
      return json({message: 'This site is not registered to a space yet'}, {status: 409})
    }
    const siteUrl = SITE_BASE_URL
    if (!siteUrl) throw new Error('SEED_BASE_URL is not set')

    const home = await grpcClient.documents.getDocument({account: accountUid, path: '', version: undefined})
    const metadata = home.metadata ? (home.metadata.toJson() as Record<string, unknown>) : {}
    const previousSiteUrl = typeof metadata.siteUrl === 'string' ? metadata.siteUrl : null
    if (previousSiteUrl === siteUrl) {
      const response: EnterpriseSiteUrlResponse = {accountUid, siteUrl, changed: false, previousSiteUrl}
      return json(response)
    }

    const listed = await grpcClient.documents.listDocumentChanges({
      account: accountUid,
      path: '',
      version: home.version,
      pageSize: BIG_INT,
    })
    const base = changeBase(listed.changes.map((change) => ({id: change.id, deps: change.deps})))
    if (home.genesis && base.genesis !== home.genesis) {
      throw new Error(`The home document's change list starts at ${base.genesis}, not its genesis ${home.genesis}`)
    }

    const keyName = await ownerKeyNameFor(accountUid)
    const signer: PrincipalSigner = {
      principal: base58btc.decode(accountUid),
      sign: async (data) => {
        const result = await grpcClient.daemon.signData({signingKeyName: keyName, data: new Uint8Array(data)})
        return new Uint8Array(result.signature)
      },
    }
    const {unsignedBytes, ts} = createChangeOps({
      ops: siteUrlOps(siteUrl),
      genesisCid: CID.parse(base.genesis),
      deps: base.heads.map((head) => CID.parse(head)),
      depth: base.depth,
    })
    const change = await createChange(unsignedBytes, signer)
    // Stay in the document's generation: a Ref in a new generation would read
    // as a re-creation of the document rather than its next version.
    const generation = Number(home.generationInfo?.generation || 0) || Number(ts)
    const ref = await createVersionRef(
      {space: accountUid, path: '', genesis: base.genesis, version: change.cid.toString(), generation},
      signer,
    )
    await grpcClient.daemon.storeBlobs({
      blobs: [{cid: change.cid.toString(), data: change.bytes}, ...ref.blobs.map((b) => ({cid: b.cid, data: b.data}))],
    })

    const response: EnterpriseSiteUrlResponse = {accountUid, siteUrl, changed: true, previousSiteUrl}
    return json(response)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('enterprise site-url update failed:', message)
    return json({message}, {status: 500})
  }
}

export const loader: LoaderFunction = async () => json({message: 'Method not allowed'}, {status: 405})
