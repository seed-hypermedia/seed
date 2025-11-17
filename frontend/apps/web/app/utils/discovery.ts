import {grpcClient} from '@/client.server'
import {getDocument} from '@/loaders'
import {
  HMBlockNode,
  HMCommentSchema,
  hmId,
  hmIdPathToEntityQueryPath,
} from '@shm/shared'
import {BIG_INT, DAEMON_HTTP_URL} from '@shm/shared/constants'
import {tryUntilSuccess} from '@shm/shared/try-until-success'
import {findtIpfsUrlCid} from '@shm/ui/get-file-url'

export async function discoverDocument(
  uid: string,
  path: string[],
  version?: string,
  latest?: boolean | undefined | null,
): Promise<{version: string} | true | null> {
  const discoverRequest = {
    account: uid,
    path: hmIdPathToEntityQueryPath(path),
    version: version || undefined,
    recursive: true,
  } as const
  function checkDiscoverySuccess(discoveredVersion: string) {
    if (latest && discoveredVersion) return true
    if (!version && discoveredVersion) return true
    if (version && version === discoveredVersion) return true
    return false
  }
  return await tryUntilSuccess(async () => {
    try {
      const discoverResp =
        await grpcClient.entities.discoverEntity(discoverRequest)
      if (checkDiscoverySuccess(discoverResp.version))
        return {version: discoverResp.version}
      return null
    } catch (e) {
      console.warn(
        `discoverEntity error on hm://${uid}${hmIdPathToEntityQueryPath(
          path,
        )},  error: ${e}`,
      )
      // becaue the discovery sometimes errors randomly, we still need to getDocument to get the equivalent of discoverResp.version
      const doc = await grpcClient.documents.getDocument({
        account: uid,
        path: hmIdPathToEntityQueryPath(path),
        version: version || undefined,
      })
      if (checkDiscoverySuccess(doc.version)) {
        return {version: doc.version}
      }
      return null
    }
  })
}

export async function discoverMedia(
  uid: string,
  path: string[],
  version?: string,
) {
  const allReferencdeIpfsCids = new Set<string>()

  function extractIpfsCids(blocks: Array<HMBlockNode>) {
    blocks.forEach((node) => {
      if (
        node.block.type === 'File' ||
        node.block.type === 'Image' ||
        (node.block.type === 'Video' && node.block.link)
      ) {
        const cid = findtIpfsUrlCid(node.block.link)
        if (cid) {
          allReferencdeIpfsCids.add(cid)
        }
      }
      if (node.children) {
        extractIpfsCids(node.children)
      }
    })
  }

  const doc = await getDocument(hmId(uid, {path, version}))
  extractIpfsCids(doc.content)
  const comments = await grpcClient.comments.listComments({
    targetAccount: uid,
    targetPath: hmIdPathToEntityQueryPath(path),
    pageSize: BIG_INT,
  })
  comments.comments.forEach((c) => {
    const comment = HMCommentSchema.parse(c.toJson())
    extractIpfsCids(comment.content)
  })
  await Promise.all(
    Array.from(allReferencdeIpfsCids).map(async (cid) => {
      await discoverIpfsCid(cid)
    }),
  )
}

async function discoverIpfsCid(cid: string) {
  const imageUrl = `${DAEMON_HTTP_URL}/ipfs/${cid}`
  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch image from ${imageUrl}`)
  }
  console.log('discoveredIpfsCid', cid)
}
