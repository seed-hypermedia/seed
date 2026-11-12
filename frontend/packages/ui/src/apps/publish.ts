import {
  addAppChildOps,
  createDocumentUpdateBlobs,
  removeAppChildOps,
  TOOL_ENTRY_FILE,
} from '@seed-hypermedia/client/apps'
import {resolveCapability} from '@seed-hypermedia/client/capability'
import type {SeedClient} from '@seed-hypermedia/client/client'
import {createDocumentBlobs} from '@seed-hypermedia/client/create-document'
import type {DocumentOperation} from '@seed-hypermedia/client/change'
import {directoryToIpfsBlobs, type CollectedBlob} from '@seed-hypermedia/client/file-to-ipfs'
import {
  hmIdPathToEntityQueryPath,
  type HMDocument,
  type HMSigner,
  type UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {encodeDagCbor} from '@seed-hypermedia/client/signed-blob'
import {useUniversalAppContext, useUniversalClient} from '@shm/shared'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useStream} from '@shm/shared/use-stream'
import {base58btc} from 'multiformats/bases/base58'
import {useMemo} from 'react'

/** An app with its current content: what adding or removing a child changes. */
export type AppRef = {id: UnpackedHypermediaId; document: HMDocument}

/**
 * Publishing for apps and tools, signed by the selected identity. Every write that adds or deletes
 * an app's child also adds or removes its card embed on the app, in the same publish.
 */
export function useAppsPublisher() {
  const client = useUniversalClient()
  const {selectedIdentity, onPushPublished} = useUniversalAppContext()
  const accountUid = useStream(selectedIdentity) ?? null
  return useMemo(() => {
    const signer: HMSigner | null = accountUid && client.getSigner ? client.getSigner(accountUid) : null
    // The universal client's `request` is the SDK client's under a differently written signature.
    const requestClient = client as unknown as Pick<SeedClient, 'request'>

    async function signerUid() {
      if (!signer) throw new Error('Select an account to sign with')
      return base58btc.encode(new Uint8Array(await signer.getPublicKey()))
    }

    /** The writer capability `id` needs (undefined in the signer's own space) and the blob that carries it. */
    async function writeAccess(id: UnpackedHypermediaId) {
      const uid = await signerUid()
      const capability = await resolveCapability(client, id.uid, uid, hmIdPathToEntityQueryPath(id.path))
      if (id.uid !== uid && !capability) throw new Error('Your account cannot write here')
      if (!capability) return {capability: undefined, blobs: [] as CollectedBlob[]}
      // Publish the grant beside the change, as the agent mount does, so the receiving node can verify it.
      const {data} = await encodeDagCbor((await client.request('GetCID', {cid: capability})).value)
      return {capability, blobs: [{cid: capability, data}]}
    }

    async function appChildBlobs(app: AppRef, child: UnpackedHypermediaId, change: 'add' | 'remove') {
      const ops =
        change === 'add'
          ? addAppChildOps(app.id, app.document.content, child)
          : removeAppChildOps(app.id, app.document.content, child)
      if (!ops.length) return []
      const access = await writeAccess(app.id)
      const update = await createDocumentUpdateBlobs({
        client: requestClient,
        signer: signer!,
        id: app.id,
        ops,
        capability: access.capability,
      })
      return [...access.blobs, ...update.blobs]
    }

    async function publish(blobs: CollectedBlob[], touched: UnpackedHypermediaId[]) {
      await client.publish({blobs})
      for (const id of touched) {
        invalidateQueries([queryKeys.ENTITY, id.id])
        invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, id.uid])
        onPushPublished?.(id)
      }
    }

    return {
      canSign: !!signer,

      /** Creates a document; when `app` is given, the new document joins the app's list. */
      async create(id: UnpackedHypermediaId, ops: DocumentOperation[], app?: AppRef, extraBlobs: CollectedBlob[] = []) {
        if (!signer) throw new Error('Select an account to sign with')
        const existing = await client.request('Resource', id).catch(() => null)
        if (existing?.type === 'document') throw new Error('A document already exists here. Choose another name.')
        const access = await writeAccess(id)
        const created = await createDocumentBlobs(signer, {
          space: id.uid,
          path: hmIdPathToEntityQueryPath(id.path),
          ops,
          capability: access.capability,
        })
        const appBlobs = app ? await appChildBlobs(app, id, 'add') : []
        await publish(
          [
            ...access.blobs,
            ...created.blobs.map((blob) => ({cid: blob.cid!, data: blob.data})),
            ...extraBlobs,
            ...appBlobs,
          ],
          app ? [id, app.id] : [id],
        )
      },

      /** Publishes `ops` (and blobs they reference, such as a code folder) as the document's next version. */
      async update(id: UnpackedHypermediaId, ops: DocumentOperation[], extraBlobs: CollectedBlob[] = []) {
        if (!signer) throw new Error('Select an account to sign with')
        const access = await writeAccess(id)
        const update = await createDocumentUpdateBlobs({
          client: requestClient,
          signer,
          id,
          ops,
          capability: access.capability,
          extraBlobs,
        })
        await publish([...access.blobs, ...update.blobs], [id])
      },

      /** Takes `child` off `app`'s list, after the child is deleted. */
      async removeFromApp(app: AppRef, child: UnpackedHypermediaId) {
        const blobs = await appChildBlobs(app, child, 'remove')
        if (blobs.length) await publish(blobs, [app.id])
      },

      /** Lists `child` on `app`, for children that exist under the app but are not listed. */
      async addToApp(app: AppRef, child: UnpackedHypermediaId) {
        const blobs = await appChildBlobs(app, child, 'add')
        if (blobs.length) await publish(blobs, [app.id])
      },
    }
  }, [accountUid, client, onPushPublished])
}

/** A tool's code as the UnixFS folder its `code` attribute points at. */
export async function toolCodeFolder(source: string): Promise<{code: string; blobs: CollectedBlob[]}> {
  const folder = await directoryToIpfsBlobs([{path: TOOL_ENTRY_FILE, content: new TextEncoder().encode(source)}])
  return {code: `ipfs://${folder.cid}`, blobs: folder.blobs}
}

/** One metadata attribute change, `null` removing it. */
export function setAttribute(key: string, value: string | null): DocumentOperation {
  return {type: 'SetAttributes', attrs: [{key: [key], value}]}
}
