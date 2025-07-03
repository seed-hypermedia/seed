import {queryClient} from '@/client'
import {getHMDocument} from '@/loaders'
import {
  BIG_INT,
  DAEMON_HTTP_URL,
  HMBlockNode,
  HMCommentSchema,
  HMDocumentSchema,
  hmId,
  hmIdPathToEntityQueryPath,
} from '@shm/shared'
import {
  documentMetadataParseAdjustments,
  getErrorMessage,
  HMRedirectError,
} from '@shm/shared/models/entity'
import {tryUntilSuccess} from '@shm/shared/try-until-success'
import {findtIpfsUrlCid} from '@shm/ui/get-file-url'

export async function discoverDocument(
  uid: string,
  path: string[],
  version?: string,
  latest?: boolean | undefined | null,
) {
  await queryClient.entities.discoverEntity({
    account: uid,
    path: hmIdPathToEntityQueryPath(path),
    version,
    recursive: true,
  })
  return await tryUntilSuccess(
    async () => {
      // console.log('discover will getDocument', uid, path, version)
      const apiDoc = await queryClient.documents.getDocument({
        account: uid,
        path: hmIdPathToEntityQueryPath(path),
        version: latest ? undefined : version || '',
      })
      const versionMatch =
        !version || apiDoc.version === version || (latest && !!apiDoc.version)
      // console.log('discover getDocument', versionMatch, apiDoc.version, version)
      if (versionMatch) {
        const docJSON = apiDoc.toJson() as any
        documentMetadataParseAdjustments(docJSON.metadata)
        const document = HMDocumentSchema.parse(docJSON)
        // console.log('discover getDocument complete', document)
        return document
      }
      return null
    },
    {
      immediateCatch: (e) => {
        const error = getErrorMessage(e)
        return error instanceof HMRedirectError
      },
    },
  )
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
