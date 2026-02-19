import {encode as cborEncode} from '@ipld/dag-cbor'
import {CID} from 'multiformats'
import {base58btc} from 'multiformats/bases/base58'
import {z} from 'zod'
import {
  HMAnnotation,
  HMBlockNode,
  HMPublishableAnnotation,
  HMPublishableBlock,
  HMSigner,
  UnpackedHypermediaId,
} from './hm-types'
import {hmIdPathToEntityQueryPath} from './utils/path-api'
import {packHmId} from './utils/entity-id-url'
import {trimTrailingEmptyBlocks} from './comments'

export const unsignedCommentSchema = z.object({
  type: z.literal('Comment'),
  body: z.array(z.any()),
  space: z.instanceof(Uint8Array),
  path: z.string(),
  version: z.string(),
  replyParent: z.string().optional(),
  threadRoot: z.string().optional(),
  signer: z.instanceof(Uint8Array),
  ts: z.bigint(),
  sig: z.instanceof(Uint8Array),
})

export type UnsignedComment = z.infer<typeof unsignedCommentSchema>

export type SignedComment = {
  type: 'Comment'
  body: HMPublishableBlock[]
  space: Uint8Array
  path: string
  version: CID[]
  replyParent?: CID
  threadRoot?: CID
  signer: Uint8Array
  ts: bigint
  sig: ArrayBuffer | Uint8Array
}

export type CommentPayload = {
  comment: Uint8Array
  blobs: {cid: string; data: Uint8Array}[]
  commentingOriginUrl?: string | undefined
}

function annotationsToPublishable(
  annotations: HMAnnotation[],
): HMPublishableAnnotation[] {
  return annotations.map((annotation) => {
    const {type, starts, ends} = annotation
    if (type === 'Bold') return {type: 'Bold', starts, ends}
    if (type === 'Italic') return {type: 'Italic', starts, ends}
    if (type === 'Underline') return {type: 'Underline', starts, ends}
    if (type === 'Strike') return {type: 'Strike', starts, ends}
    if (type === 'Code') return {type: 'Code', starts, ends}
    if (type === 'Link')
      return {type: 'Link', starts, ends, link: annotation.link || ''}
    if (type === 'Embed')
      return {type: 'Embed', starts, ends, link: annotation.link || ''}
    throw new Error(`Unsupported annotation type: ${type}`)
  })
}

function blockToPublishable(blockNode: HMBlockNode): HMPublishableBlock | null {
  const block = blockNode.block
  if (block.type === 'Paragraph') {
    if (block.text === '') return null
    if (block.text === undefined) return null
    return {
      id: block.id,
      type: 'Paragraph',
      text: block.text,
      annotations: annotationsToPublishable(block.annotations || []),
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    }
  } else if (block.type === 'Heading') {
    return {
      id: block.id,
      type: 'Heading',
      text: block.text,
      annotations: annotationsToPublishable(block.annotations || []),
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    }
  } else if (block.type === 'Math') {
    return {
      id: block.id,
      type: 'Math',
      text: block.text,
      annotations: annotationsToPublishable(block.annotations || []),
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    }
  } else if (block.type === 'Code') {
    return {
      id: block.id,
      type: 'Code',
      text: block.text,
      annotations: annotationsToPublishable(block.annotations || []),
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    }
  } else if (block.type === 'Image') {
    return {
      id: block.id,
      type: 'Image',
      text: block.text,
      link: block.link,
      annotations: annotationsToPublishable(block.annotations || []),
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    }
  } else if (block.type === 'Video') {
    return {
      id: block.id,
      type: 'Video',
      text: '',
      link: block.link,
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    }
  } else if (block.type === 'File') {
    return {
      id: block.id,
      type: 'File',
      link: block.link,
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    }
  } else if (block.type === 'Button') {
    return {
      id: block.id,
      type: 'Button',
      text: block.text,
      link: block.link,
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    }
  } else if (block.type === 'Embed') {
    return {
      id: block.id,
      type: 'Embed',
      link: block.link,
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    }
  } else if (block.type === 'WebEmbed') {
    return {
      id: block.id,
      type: 'WebEmbed',
      link: block.link,
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    }
  }
  throw new Error(`Unsupported block type: ${block.type}`)
}

export function hmBlocksToPublishable(
  blockNodes: HMBlockNode[],
): HMPublishableBlock[] {
  return blockNodes
    .map((blockNode) => {
      const block = blockToPublishable(blockNode)
      if (!block) return null
      return block
    })
    .filter((blockNode) => blockNode !== null)
}

function cleanContentOfUndefined(content: HMBlockNode[]) {
  content.forEach((blockNode) => {
    const {block, children} = blockNode
    // @ts-expect-error - text exists on paragraph/heading blocks
    if (typeof block.text === 'undefined') block.text = ''
    if (children) cleanContentOfUndefined(children)
  })
}

async function signObject(signer: HMSigner, data: any): Promise<Uint8Array> {
  const cborData = cborEncode(data)
  return await signer.sign(cborData)
}

export function createUnsignedComment({
  content,
  docId,
  docVersion,
  signerKey,
  replyCommentVersion,
  rootReplyCommentVersion,
}: {
  content: HMBlockNode[]
  docId: UnpackedHypermediaId
  docVersion: string
  signerKey: Uint8Array
  replyCommentVersion?: string | null
  rootReplyCommentVersion?: string | null
}): UnsignedComment {
  const unsignedComment: UnsignedComment = {
    type: 'Comment',
    body: hmBlocksToPublishable(content),
    space: new Uint8Array(base58btc.decode(docId.uid)),
    version: docVersion,
    signer: new Uint8Array(signerKey),
    ts: BigInt(Date.now()),
    sig: new Uint8Array(64),
    path: hmIdPathToEntityQueryPath(docId.path),
    replyParent: replyCommentVersion || undefined,
    threadRoot: rootReplyCommentVersion || undefined,
  }
  // ipld fails to encode undefined, so they must be removed
  if (!unsignedComment.replyParent) delete unsignedComment.replyParent
  if (!unsignedComment.threadRoot) delete unsignedComment.threadRoot
  return unsignedComment
}

export function createSignedComment(
  comment: UnsignedComment,
  signature: ArrayBuffer | Uint8Array,
): SignedComment {
  const signedComment = {
    ...comment,
    version: comment.version.split('.').map((v) => CID.parse(v)),
    replyParent: comment.replyParent
      ? CID.parse(comment.replyParent)
      : undefined,
    threadRoot: comment.threadRoot ? CID.parse(comment.threadRoot) : undefined,
    sig: signature,
  } satisfies SignedComment
  // ipld fails to encode undefined, so they must be removed
  if (!signedComment.replyParent) delete signedComment.replyParent
  if (!signedComment.threadRoot) delete signedComment.threadRoot
  return signedComment
}

export async function signComment(
  comment: UnsignedComment,
  signer: HMSigner,
): Promise<SignedComment> {
  const commentForSigning = {
    ...comment,
    version: comment.version.split('.').map((v) => CID.parse(v)),
  } as SignedComment
  if (comment.threadRoot) {
    commentForSigning.threadRoot = CID.parse(comment.threadRoot)
  }
  if (comment.replyParent) {
    commentForSigning.replyParent = CID.parse(comment.replyParent)
  }
  commentForSigning.sig = await signObject(signer, commentForSigning)
  return commentForSigning
}

export async function createComment({
  content,
  docId,
  docVersion,
  signer,
  replyCommentVersion,
  rootReplyCommentVersion,
}: {
  content: HMBlockNode[]
  docId: UnpackedHypermediaId
  docVersion: string
  signer: HMSigner
  replyCommentVersion?: string | null
  rootReplyCommentVersion?: string | null
}) {
  const signerKey = await signer.getPublicKey()
  cleanContentOfUndefined(content)
  const unsignedComment = createUnsignedComment({
    content,
    docId,
    docVersion,
    signerKey,
    replyCommentVersion,
    rootReplyCommentVersion,
  })
  const signedComment = await signComment(unsignedComment, signer)
  return signedComment
}

function generateBlockId(length: number = 8): string {
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length))
  }
  return result
}

export async function prepareComment(
  getContent: (
    prepareAttachments: (binaries: Uint8Array[]) => Promise<{
      blobs: {cid: string; data: Uint8Array}[]
      resultCIDs: string[]
    }>,
  ) => Promise<{
    blockNodes: HMBlockNode[]
    blobs: {cid: string; data: Uint8Array}[]
  }>,
  commentMeta: {
    docId: UnpackedHypermediaId
    docVersion: string
    signer: HMSigner
    replyCommentVersion?: string | null
    rootReplyCommentVersion?: string | null
    quotingBlockId?: string
    prepareAttachments?: (binaries: Uint8Array[]) => Promise<{
      blobs: {cid: string; data: Uint8Array}[]
      resultCIDs: string[]
    }>
  },
  commentingOriginUrl?: string | undefined,
): Promise<CommentPayload> {
  const defaultPrepareAttachments = async (_binaries: Uint8Array[]) => ({
    blobs: [] as {cid: string; data: Uint8Array}[],
    resultCIDs: [] as string[],
  })

  const {blockNodes: rawBlockNodes, blobs} = await getContent(
    commentMeta.prepareAttachments || defaultPrepareAttachments,
  )
  const blockNodes = trimTrailingEmptyBlocks(rawBlockNodes)

  const publishContent = commentMeta.quotingBlockId
    ? [
        {
          block: {
            id: generateBlockId(8),
            type: 'Embed',
            text: '',
            attributes: {
              childrenType: 'Group',
              view: 'Content',
            },
            annotations: [],
            link: packHmId({
              ...commentMeta.docId,
              blockRef: commentMeta.quotingBlockId,
              version: commentMeta.docVersion,
            }),
          },
          children: blockNodes,
        } as HMBlockNode,
      ]
    : blockNodes

  const signedComment = await createComment({
    content: publishContent,
    docId: commentMeta.docId,
    docVersion: commentMeta.docVersion,
    signer: commentMeta.signer,
    replyCommentVersion: commentMeta.replyCommentVersion,
    rootReplyCommentVersion: commentMeta.rootReplyCommentVersion,
  })
  const result: CommentPayload = {
    comment: cborEncode(signedComment),
    blobs,
  }
  if (commentingOriginUrl) result.commentingOriginUrl = commentingOriginUrl
  return result
}
