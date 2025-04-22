import {queryClient} from '@/client'
import {hmIdPathToEntityQueryPath} from '@shm/shared'
import {tryUntilSuccess} from './try-until-success'

export async function discoverDocument(
  uid: string,
  path: string[],
  version?: string,
) {
  console.log('discovering document', uid, path, version)
  await queryClient.entities.discoverEntity({
    account: uid,
    path: hmIdPathToEntityQueryPath(path),
    version: version,
    recursive: true,
  })
  await tryUntilSuccess(async () => {
    const document = await queryClient.documents.getDocument({
      account: uid,
      path: hmIdPathToEntityQueryPath(path),
      version: version,
    })
    console.log('trying disovered document', version, document.version)
    return document.version === version
  })
}
