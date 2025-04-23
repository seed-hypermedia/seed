import {queryClient} from '@/client'
import {hmIdPathToEntityQueryPath} from '@shm/shared'
import {tryUntilSuccess} from './try-until-success'

export async function discoverDocument(
  uid: string,
  path: string[],
  version?: string,
) {
  await queryClient.entities.discoverEntity({
    account: uid,
    path: hmIdPathToEntityQueryPath(path),
    version,
    recursive: true,
  })
  await tryUntilSuccess(async () => {
    const document = await queryClient.documents.getDocument({
      account: uid,
      path: hmIdPathToEntityQueryPath(path),
      version: version,
    })
    return !version || document.version === version
  })
}
