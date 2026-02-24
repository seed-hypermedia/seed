import {encode as cborEncode} from '@ipld/dag-cbor'
import type {
  HMAnnotation,
  HMBlockNode,
  HMPublishBlobsInput,
  HMPublishableAnnotation,
  HMPublishableBlock,
  HMSigner,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {trimTrailingEmptyBlocks} from '@shm/shared/comments'
import {packHmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {CID} from 'multiformats'
import {base58btc} from 'multiformats/bases/base58'

export type CommentAttachmentBlob = {
  cid: string
  data: Uint8Array
}

type PrepareAttachments = (binaries: Uint8Array[]) => Promise<{
  blobs: CommentAttachmentBlob[]
  resultCIDs: string[]
}>

type CreateCommentBaseInput = {
  docId: UnpackedHypermediaId
  docVersion: string
  replyCommentVersion?: string | null
  rootReplyCommentVersion?: string | null
  quotingBlockId?: string
}

export type CreateCommentInput =
  | (CreateCommentBaseInput & {
      content: HMBlockNode[]
      blobs?: CommentAttachmentBlob[]
    })
  | (CreateCommentBaseInput & {
      getContent: (prepareAttachments: PrepareAttachments) => Promise<{
        blockNodes: HMBlockNode[]
        blobs: CommentAttachmentBlob[]
      }>
      prepareAttachments?: PrepareAttachments
    })

type UnsignedComment = {
  type: 'Comment'
  body: HMPublishableBlock[]
  space: Uint8Array
  path: string
  version: string
  replyParent?: string
  threadRoot?: string
  signer: Uint8Array
  ts: bigint
  sig: Uint8Array
}

type SignedComment = {
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

function normalizeBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const normalized = new Uint8Array(data.byteLength)
  normalized.set(data)
  return normalized
}

function toPublishInput(comment: Uint8Array, blobs: CommentAttachmentBlob[]): HMPublishBlobsInput {
  return {
    blobs: [
      {data: normalizeBytes(comment)},
      ...blobs.map((blob) => ({
        cid: blob.cid,
        data: normalizeBytes(blob.data),
      })),
    ],
  }
}

function annotationsToPublishable(annotations: HMAnnotation[]): HMPublishableAnnotation[] {
  return annotations.map((annotation) => {
    const {type, starts, ends} = annotation
    if (type === 'Bold') return {type: 'Bold', starts, ends}
    if (type === 'Italic') return {type: 'Italic', starts, ends}
    if (type === 'Underline') return {type: 'Underline', starts, ends}
    if (type === 'Strike') return {type: 'Strike', starts, ends}
    if (type === 'Code') return {type: 'Code', starts, ends}
    if (type === 'Link') return {type: 'Link', starts, ends, link: annotation.link || ''}
    if (type === 'Embed') return {type: 'Embed', starts, ends, link: annotation.link || ''}
    throw new Error(`Unsupported annotation type: ${type}`)
  })
}

function blockToPublishable(blockNode: HMBlockNode): HMPublishableBlock | null {
  const block = blockNode.block
  if (block.type === 'Paragraph') {
    if (block.text === '' || block.text === undefined) return null
    return {
      id: block.id,
      type: 'Paragraph',
      text: block.text,
      annotations: annotationsToPublishable(block.annotations || []),
      ...block.attributes,
      children: blocksToPublishable(blockNode.children || []),
    }
  }
  if (block.type === 'Heading') {
    return {
      id: block.id,
      type: 'Heading',
      text: block.text,
      annotations: annotationsToPublishable(block.annotations || []),
      ...block.attributes,
      children: blocksToPublishable(blockNode.children || []),
    }
  }
  if (block.type === 'Math') {
    return {
      id: block.id,
      type: 'Math',
      text: block.text,
      annotations: annotationsToPublishable(block.annotations || []),
      ...block.attributes,
      children: blocksToPublishable(blockNode.children || []),
    }
  }
  if (block.type === 'Code') {
    return {
      id: block.id,
      type: 'Code',
      text: block.text,
      annotations: annotationsToPublishable(block.annotations || []),
      ...block.attributes,
      children: blocksToPublishable(blockNode.children || []),
    }
  }
  if (block.type === 'Image') {
    return {
      id: block.id,
      type: 'Image',
      text: block.text,
      link: block.link,
      annotations: annotationsToPublishable(block.annotations || []),
      ...block.attributes,
      children: blocksToPublishable(blockNode.children || []),
    }
  }
  if (block.type === 'Video') {
    return {
      id: block.id,
      type: 'Video',
      text: '',
      link: block.link,
      ...block.attributes,
      children: blocksToPublishable(blockNode.children || []),
    }
  }
  if (block.type === 'File') {
    return {
      id: block.id,
      type: 'File',
      link: block.link,
      ...block.attributes,
      children: blocksToPublishable(blockNode.children || []),
    }
  }
  if (block.type === 'Button') {
    return {
      id: block.id,
      type: 'Button',
      text: block.text,
      link: block.link,
      ...block.attributes,
      children: blocksToPublishable(blockNode.children || []),
    }
  }
  if (block.type === 'Embed') {
    return {
      id: block.id,
      type: 'Embed',
      link: block.link,
      ...block.attributes,
      children: blocksToPublishable(blockNode.children || []),
    }
  }
  if (block.type === 'WebEmbed') {
    return {
      id: block.id,
      type: 'WebEmbed',
      link: block.link,
      ...block.attributes,
      children: blocksToPublishable(blockNode.children || []),
    }
  }
  throw new Error(`Unsupported block type: ${block.type}`)
}

function blocksToPublishable(blockNodes: HMBlockNode[]): HMPublishableBlock[] {
  return blockNodes
    .map((blockNode) => {
      const block = blockToPublishable(blockNode)
      if (!block) return null
      return block
    })
    .filter((blockNode): blockNode is HMPublishableBlock => blockNode !== null)
}

function cleanContentOfUndefined(content: HMBlockNode[]) {
  content.forEach((blockNode) => {
    const {block, children} = blockNode
    // @ts-expect-error - text exists on paragraph/heading blocks
    if (typeof block.text === 'undefined') block.text = ''
    if (children) cleanContentOfUndefined(children)
  })
}

async function signObject(signer: HMSigner, data: unknown): Promise<Uint8Array> {
  return await signer.sign(cborEncode(data))
}

function createUnsignedComment({
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
    body: blocksToPublishable(content),
    space: new Uint8Array(base58btc.decode(docId.uid)),
    version: docVersion,
    signer: new Uint8Array(signerKey),
    ts: BigInt(Date.now()),
    sig: new Uint8Array(64),
    path: hmIdPathToEntityQueryPath(docId.path),
    replyParent: replyCommentVersion || undefined,
    threadRoot: rootReplyCommentVersion || undefined,
  }
  if (!unsignedComment.replyParent) delete unsignedComment.replyParent
  if (!unsignedComment.threadRoot) delete unsignedComment.threadRoot
  return unsignedComment
}

async function createSignedComment(comment: UnsignedComment, signer: HMSigner): Promise<SignedComment> {
  const commentForSigning = {
    ...comment,
    version: comment.version.split('.').map((v) => CID.parse(v)),
  } as SignedComment
  if (comment.threadRoot) commentForSigning.threadRoot = CID.parse(comment.threadRoot)
  if (comment.replyParent) commentForSigning.replyParent = CID.parse(comment.replyParent)
  commentForSigning.sig = await signObject(signer, commentForSigning)
  return commentForSigning
}

async function createCommentBlob({
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
}): Promise<Uint8Array> {
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
  const signedComment = await createSignedComment(unsignedComment, signer)
  return cborEncode(signedComment)
}

function generateBlockId(length: number = 8): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length))
  }
  return result
}

function wrapQuotedContent(content: HMBlockNode[], input: CreateCommentBaseInput): HMBlockNode[] {
  if (!input.quotingBlockId) return content
  return [
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
          ...input.docId,
          blockRef: input.quotingBlockId,
          version: input.docVersion,
        }),
      },
      children: content,
    } as HMBlockNode,
  ]
}

async function resolveCommentContentAndBlobs(input: CreateCommentInput): Promise<{
  content: HMBlockNode[]
  blobs: CommentAttachmentBlob[]
}> {
  const defaultPrepareAttachments = async (_binaries: Uint8Array[]) => ({
    blobs: [] as CommentAttachmentBlob[],
    resultCIDs: [] as string[],
  })

  if ('getContent' in input) {
    const {blockNodes: rawBlockNodes, blobs} = await input.getContent(
      input.prepareAttachments || defaultPrepareAttachments,
    )
    return {
      content: wrapQuotedContent(trimTrailingEmptyBlocks(rawBlockNodes), input),
      blobs,
    }
  }

  return {
    content: wrapQuotedContent(trimTrailingEmptyBlocks(input.content), input),
    blobs: input.blobs || [],
  }
}

export async function createComment(input: CreateCommentInput, signer: HMSigner): Promise<HMPublishBlobsInput> {
  const {content, blobs} = await resolveCommentContentAndBlobs(input)
  const comment = await createCommentBlob({
    content,
    docId: input.docId,
    docVersion: input.docVersion,
    signer,
    replyCommentVersion: input.replyCommentVersion,
    rootReplyCommentVersion: input.rootReplyCommentVersion,
  })
  return toPublishInput(comment, blobs)
}
