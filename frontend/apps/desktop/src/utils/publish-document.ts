import type {HMSigner, SeedClient} from '@seed-hypermedia/client'
import type {PublishDocumentInput} from '@shm/shared/universal-client'

type PublishDesktopDocumentDeps = {
  publishDocument: SeedClient['publishDocument']
  getSigner: (accountUid: string) => HMSigner
}

/** Whether this publish still needs the deprecated daemon CreateDocumentChange path. */
export function shouldUseDaemonCreateDocumentChange(input: PublishDocumentInput): boolean {
  void input
  return false
}

/** Publishes a desktop document through PrepareDocumentChange and PublishBlobs. */
export async function publishDesktopDocument(
  deps: PublishDesktopDocumentDeps,
  input: PublishDocumentInput,
): Promise<void> {
  const {signerAccountUid, ...publishInput} = input
  await deps.publishDocument(publishInput, deps.getSigner(signerAccountUid))
}
