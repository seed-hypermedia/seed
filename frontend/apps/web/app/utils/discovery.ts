import {queryClient} from '@/client'
import {getHMDocument} from '@/loaders'
import {
  BIG_INT,
  DAEMON_HTTP_URL,
  DiscoverEntityResponse,
  HMBlockNode,
  HMCommentSchema,
  hmId,
  hmIdPathToEntityQueryPath,
} from '@shm/shared'
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
  function checkDiscoverySuccess(discoverResp: DiscoverEntityResponse) {
    if (latest && discoverResp.version) return true
    if (!version && discoverResp.version) return true
    if (version && version === discoverResp.version) return true
    return false
  }
  return await tryUntilSuccess(async () => {
    console.log('will discoverEntity', discoverRequest)
    try {
      const discoverResp =
        await queryClient.entities.discoverEntity(discoverRequest)
      console.log('~~ discoverEntity resp', discoverResp.toJson())
      if (checkDiscoverySuccess(discoverResp))
        return {version: discoverResp.version}
      return true
    } catch (e) {
      console.warn(
        `discoverEntity error on hm://${uid}${hmIdPathToEntityQueryPath(
          path,
        )},  error: ${e}`,
      )
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

  const doc = await getHMDocument(hmId('d', uid, {path, version}))
  extractIpfsCids(doc.content)
  const comments = await queryClient.comments.listComments({
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
