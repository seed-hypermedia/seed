import {createDocumentChange, createGenesisChange, createVersionRef, signDocumentChange} from '@seed-hypermedia/client'
import type {HMRequest, HMSigner, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {PublishDocumentInput, UniversalClient} from './universal-client'

export type WebClientDependencies = Pick<UniversalClient, 'request' | 'publish'> & {
  CommentEditor: (props: {docId: UnpackedHypermediaId}) => JSX.Element
  fetchRecents?: () => Promise<any[]>
  deleteRecent?: (id: string) => Promise<void>
  getSigner?: (accountUid: string) => HMSigner
}

export function createWebUniversalClient(deps: WebClientDependencies): UniversalClient {
  async function publishDocument(input: PublishDocumentInput): Promise<void> {
    if (!deps.getSigner) throw new Error('getSigner is required for publishDocument')
    const signer = deps.getSigner(input.signerAccountUid)

    // Brand-new home documents need their deterministic genesis change created
    // and signed client-side. For metadata-only account creation we can create
    // the first content change locally; content blocks still go through
    // PrepareDocumentChange after publishing an initial resolvable genesis ref.
    if (!input.genesis && !input.baseVersion && !input.path) {
      const genesisChange = await createGenesisChange(signer)
      const generation = input.generation != null ? Number(input.generation) : 1

      if (input.changes.every((change) => change.op?.case === 'setMetadata')) {
        const contentChange = await createDocumentChange(
          {
            changes: input.changes,
            genesisCid: genesisChange.cid,
            deps: [genesisChange.cid],
            depth: 1,
          },
          signer,
        )
        const ref = await createVersionRef(
          {
            space: input.account,
            path: '',
            genesis: genesisChange.cid.toString(),
            version: contentChange.cid.toString(),
            generation,
            capability: input.capability,
          },
          signer,
        )
        await deps.publish({
          blobs: [
            {data: genesisChange.bytes, cid: genesisChange.cid.toString()},
            {data: contentChange.bytes, cid: contentChange.cid.toString()},
            ...ref.blobs,
          ],
        })
        return
      }

      const genesisRef = await createVersionRef(
        {
          space: input.account,
          path: '',
          genesis: genesisChange.cid.toString(),
          version: genesisChange.cid.toString(),
          generation,
          capability: input.capability,
        },
        signer,
      )
      await deps.publish({
        blobs: [{data: genesisChange.bytes, cid: genesisChange.cid.toString()}, ...genesisRef.blobs],
      })
      input = {
        ...input,
        baseVersion: genesisChange.cid.toString(),
        genesis: genesisChange.cid.toString(),
        generation,
      }
    }

    // Use PrepareDocumentChange for both new and existing documents so the server
    // can prepare all supported ops.
    const {unsignedChange} = (await deps.request('PrepareDocumentChange', {
      account: input.account,
      path: input.path,
      baseVersion: input.baseVersion,
      changes: input.changes,
      capability: input.capability,
      visibility: input.visibility,
    })) as Extract<HMRequest, {key: 'PrepareDocumentChange'}>['output']
    const {publishInput} = await signDocumentChange(
      {
        account: input.account,
        path: input.path,
        unsignedChange,
        genesis: input.genesis,
        generation: input.generation,
        capability: input.capability,
        visibility: input.visibility,
      },
      signer,
    )
    await deps.publish(publishInput)
  }

  return {
    CommentEditor: deps.CommentEditor,
    fetchRecents: deps.fetchRecents,
    deleteRecent: deps.deleteRecent,

    getSigner: deps.getSigner,

    request: deps.request,
    publish: deps.publish,

    publishDocument: deps.getSigner ? publishDocument : undefined,
  }
}
