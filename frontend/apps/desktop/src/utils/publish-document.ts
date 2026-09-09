import type {HMSigner, SeedClient} from '@seed-hypermedia/client'
import type {PublishDocumentInput} from '@shm/shared/universal-client'

type PublishDesktopDocumentDeps = {
  publishDocument: SeedClient['publishDocument']
  getSigner: (accountUid: string) => HMSigner
}
/** Publishes a desktop document through PrepareDocumentChange and PublishBlobs. */
export async function publishDesktopDocument(
  deps: PublishDesktopDocumentDeps,
  input: PublishDocumentInput,
): Promise<import('@seed-hypermedia/client').PublishDocumentResult | void> {
  const {signerAccountUid, ...publishInput} = input
  return deps.publishDocument(publishInput, deps.getSigner(signerAccountUid))
}
