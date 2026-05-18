import type {HMSigner, SeedClient} from '@seed-hypermedia/client'
import {DocumentChange, ResourceVisibility} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import type {PublishDocumentInput} from '@shm/shared/universal-client'

const PRIVATE_DOC_DEBUG_PREFIX = '[private-doc-debug]'

type CreateDocumentChangeRequest = {
  signingKeyName: string
  account: string
  path: string
  baseVersion: string
  changes: DocumentChange[]
  capability: string
  visibility: ResourceVisibility
}

type PublishDesktopDocumentDeps = {
  createDocumentChange: (input: CreateDocumentChangeRequest) => Promise<unknown>
  publishDocument: SeedClient['publishDocument']
  getSigner: (accountUid: string) => HMSigner
}

/** Uses the daemon publish path for updates to existing published documents and new root documents. */
export function shouldUseDaemonCreateDocumentChange(input: PublishDocumentInput): boolean {
  // Use daemon for updates to existing documents (has baseVersion and genesis),
  // and for new root documents (path is empty) which need genesis creation
  // via ensureProfileGenesis — PrepareChange cannot handle this.
  return (!!input.baseVersion && !!input.genesis) || !input.path
}

/** Normalizes document publish input into a daemon create-document-change request. */
export function createDocumentChangeRequest(input: PublishDocumentInput): CreateDocumentChangeRequest {
  const request = {
    signingKeyName: input.signerAccountUid,
    account: input.account,
    path: input.path ?? '',
    baseVersion: input.baseVersion ?? '',
    changes: input.changes.map(
      (change) => new DocumentChange(change as ConstructorParameters<typeof DocumentChange>[0]),
    ),
    capability: input.capability ?? '',
    visibility: input.baseVersion ? ResourceVisibility.UNSPECIFIED : input.visibility ?? ResourceVisibility.UNSPECIFIED,
  }
  if (input.visibility === ResourceVisibility.PRIVATE || request.visibility === ResourceVisibility.PRIVATE) {
    console.log(PRIVATE_DOC_DEBUG_PREFIX, 'daemon createDocumentChange request normalized', {
      input: {
        signerAccountUid: input.signerAccountUid,
        account: input.account,
        path: input.path,
        baseVersion: input.baseVersion,
        genesis: input.genesis,
        visibility: input.visibility,
        capability: input.capability,
        changeCount: input.changes.length,
      },
      request: {
        ...request,
        changes: {
          count: request.changes.length,
          opCases: request.changes.map((change) => change.op.case),
        },
      },
    })
  }
  return request
}

/** Publishes a desktop document through the daemon or the generic client publish path. */
export async function publishDesktopDocument(
  deps: PublishDesktopDocumentDeps,
  input: PublishDocumentInput,
): Promise<void> {
  const useDaemon = shouldUseDaemonCreateDocumentChange(input)
  if (input.visibility === ResourceVisibility.PRIVATE) {
    console.log(PRIVATE_DOC_DEBUG_PREFIX, 'desktop publishDocument routing decision', {
      signerAccountUid: input.signerAccountUid,
      account: input.account,
      path: input.path,
      baseVersion: input.baseVersion,
      genesis: input.genesis,
      generation: input.generation,
      visibility: input.visibility,
      capability: input.capability,
      changeCount: input.changes.length,
      useDaemon,
    })
  }
  if (useDaemon) {
    const request = createDocumentChangeRequest(input)
    if (input.visibility === ResourceVisibility.PRIVATE || request.visibility === ResourceVisibility.PRIVATE) {
      console.log(PRIVATE_DOC_DEBUG_PREFIX, 'desktop sending daemon createDocumentChange', {
        ...request,
        changes: {
          count: request.changes.length,
          opCases: request.changes.map((change) => change.op.case),
        },
      })
    }
    await deps.createDocumentChange(request)
    if (input.visibility === ResourceVisibility.PRIVATE || request.visibility === ResourceVisibility.PRIVATE) {
      console.log(PRIVATE_DOC_DEBUG_PREFIX, 'desktop daemon createDocumentChange success', {
        account: request.account,
        path: request.path,
        visibility: request.visibility,
      })
    }
    return
  }

  const {signerAccountUid, ...publishInput} = input
  if (input.visibility === ResourceVisibility.PRIVATE) {
    console.log(PRIVATE_DOC_DEBUG_PREFIX, 'desktop sending seedClient.publishDocument', {
      ...publishInput,
      changes: {
        count: publishInput.changes.length,
        opCases: publishInput.changes.map((change: any) => change?.op?.case),
      },
    })
  }
  await deps.publishDocument(publishInput, deps.getSigner(signerAccountUid))
  if (input.visibility === ResourceVisibility.PRIVATE) {
    console.log(PRIVATE_DOC_DEBUG_PREFIX, 'desktop seedClient.publishDocument success', {
      account: publishInput.account,
      path: publishInput.path,
      visibility: publishInput.visibility,
    })
  }
}
