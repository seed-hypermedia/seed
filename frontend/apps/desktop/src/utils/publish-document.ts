import type {HMSigner, SeedClient} from '@seed-hypermedia/client'
import {DocumentChange, ResourceVisibility} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import type {PublishDocumentInput} from '@shm/shared/universal-client'

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

export function shouldUseDaemonCreateDocumentChange(input: PublishDocumentInput): boolean {
  return (input.path ?? '') === '' && !!input.baseVersion
}

export function createDocumentChangeRequest(input: PublishDocumentInput): CreateDocumentChangeRequest {
  return {
    signingKeyName: input.signerAccountUid,
    account: input.account,
    path: input.path ?? '',
    baseVersion: input.baseVersion ?? '',
    changes: input.changes.map(
      (change) => new DocumentChange(change as ConstructorParameters<typeof DocumentChange>[0]),
    ),
    capability: input.capability ?? '',
    visibility: ResourceVisibility.UNSPECIFIED,
  }
}

export async function publishDesktopDocument(
  deps: PublishDesktopDocumentDeps,
  input: PublishDocumentInput,
): Promise<void> {
  if (shouldUseDaemonCreateDocumentChange(input)) {
    await deps.createDocumentChange(createDocumentChangeRequest(input))
    return
  }

  const {signerAccountUid, ...publishInput} = input
  await deps.publishDocument(publishInput, deps.getSigner(signerAccountUid))
}
