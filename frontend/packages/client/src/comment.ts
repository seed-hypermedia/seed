import {decode as cborDecode, encode as cborEncode} from '@ipld/dag-cbor'
import type {
  HMAnnotation,
  HMBlockNode,
  HMPublishBlobsInput,
  HMPublishableAnnotation,
  HMPublishableBlock,
  HMSigner,
  UnpackedHypermediaId,
} from './hm-types'
import {hmIdPathToEntityQueryPath, packHmId} from './hm-types'
import {CID} from 'multiformats'
import {base58btc} from 'multiformats/bases/base58'
import {signObject, toPublishInput} from './signing'

// ─── Block trimming ─────────────────────────────────────────────────────────

/**
 * Removes trailing empty blocks from comment content before publishing.
 * The editor always keeps a trailing empty paragraph for UX, but we
 * don't want to publish it.
 */
export function trimTrailingEmptyBlocks(blocks: HMBlockNode[]): HMBlockNode[] {
  let end = blocks.length
  while (end > 0) {
    const node = blocks[end - 1]!
    if (!isEmptyBlockNode(node)) break
    end--
  }
  return blocks.slice(0, end)
}

function isEmptyBlockNode(node: HMBlockNode): boolean {
  const {block, children} = node
  if (children && children.length > 0) return false
  if (block.type !== 'Paragraph' && block.type !== 'Heading') return false
  return !block.text || block.text.trim() === ''
}

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
  visibility?: 'Private' | ''
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
  visibility?: string
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
  visibility?: string
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

function createUnsignedComment({
  content,
  docId,
  docVersion,
  signerKey,
  replyCommentVersion,
  rootReplyCommentVersion,
  visibility,
}: {
  content: HMBlockNode[]
  docId: UnpackedHypermediaId
  docVersion: string
  signerKey: Uint8Array
  replyCommentVersion?: string | null
  rootReplyCommentVersion?: string | null
  visibility?: 'Private' | ''
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
  if (visibility) unsignedComment.visibility = visibility
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
  visibility,
}: {
  content: HMBlockNode[]
  docId: UnpackedHypermediaId
  docVersion: string
  signer: HMSigner
  replyCommentVersion?: string | null
  rootReplyCommentVersion?: string | null
  visibility?: 'Private' | ''
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
    visibility,
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
    visibility: input.visibility,
  })
  return toPublishInput(comment, blobs)
}

export type DeleteCommentInput = {
  commentId: string // record ID: "authority/tsid"
  targetAccount: string // space uid
  targetPath: string // path (e.g., "/doc1")
  targetVersion: string // version string (e.g., "cid1.cid2")
  visibility?: 'Private' | ''
}

export async function deleteComment(input: DeleteCommentInput, signer: HMSigner): Promise<HMPublishBlobsInput> {
  // Extract TSID from comment ID (format: "authority/tsid")
  const parts = input.commentId.split('/')
  const tsid = parts[1]
  if (!tsid) {
    throw new Error(`Invalid comment ID format: ${input.commentId}`)
  }

  const signerKey = await signer.getPublicKey()

  // Create the tombstone comment object for signing
  // Empty body signals deletion, zeroed thread/reply refs, same TSID as original
  const tombstone: Record<string, unknown> = {
    type: 'Comment',
    id: tsid,
    body: [],
    space: new Uint8Array(base58btc.decode(input.targetAccount)),
    path: input.targetPath,
    version: input.targetVersion.split('.').map((v) => CID.parse(v)),
    signer: new Uint8Array(signerKey),
    ts: BigInt(Date.now()),
    sig: new Uint8Array(64),
  }
  if (input.visibility) tombstone.visibility = input.visibility

  // Sign the tombstone (CBOR-encode with zeroed sig, then sign)
  tombstone.sig = await signObject(signer, tombstone)

  // Encode to CBOR and return as publish input
  const encoded = cborEncode(tombstone)
  return toPublishInput(encoded, [])
}

/** Input for updating an existing comment. */
export type UpdateCommentInput = {
  commentId: string // record ID: "authority/tsid"
  targetAccount: string // space uid
  targetPath: string // path (e.g., "/doc1")
  targetVersion: string // version string (e.g., "cid1.cid2")
  content: HMBlockNode[]
  replyParentVersion?: string | null
  rootReplyCommentVersion?: string | null
  visibility?: 'Private' | ''
}

/** Creates a signed update blob for an existing comment. */
export async function updateComment(
  input: UpdateCommentInput,
  signer: HMSigner,
): Promise<HMPublishBlobsInput> {
  // Extract TSID from comment ID (format: "authority/tsid")
  const parts = input.commentId.split('/')
  const tsid = parts[1]
  if (!tsid) {
    throw new Error(`Invalid comment ID format: ${input.commentId}`)
  }

  const signerKey = await signer.getPublicKey()
  cleanContentOfUndefined(input.content)
  const trimmedContent = trimTrailingEmptyBlocks(input.content)

  const comment: Record<string, unknown> = {
    type: 'Comment',
    id: tsid,
    body: blocksToPublishable(trimmedContent),
    space: new Uint8Array(base58btc.decode(input.targetAccount)),
    path: input.targetPath,
    version: input.targetVersion.split('.').map((v) => CID.parse(v)),
    signer: new Uint8Array(signerKey),
    ts: BigInt(Date.now()),
    sig: new Uint8Array(64),
  }
  if (input.replyParentVersion) comment.replyParent = CID.parse(input.replyParentVersion)
  if (input.rootReplyCommentVersion) comment.threadRoot = CID.parse(input.rootReplyCommentVersion)
  if (input.visibility) comment.visibility = input.visibility

  comment.sig = await signObject(signer, comment)

  const encoded = cborEncode(comment)
  return toPublishInput(encoded, [])
}

/**
 * Compute the record ID ("authority/tsid") from raw CBOR-encoded comment blob bytes.
 * The TSID is a 10-byte base58btc value: 6 bytes ms timestamp + 4 bytes SHA256 prefix.
 */
export async function commentRecordIdFromBlob(blobData: Uint8Array): Promise<string> {
  const decoded = cborDecode(blobData) as Record<string, unknown>
  if (decoded.type !== 'Comment') {
    throw new Error(`Expected Comment blob, got "${decoded.type}"`)
  }
  const signerBytes = decoded.signer as Uint8Array
  const ts = BigInt(decoded.ts as bigint | number)
  const authority = base58btc.encode(new Uint8Array(signerBytes))

  // 6 bytes for timestamp (lower 48 bits of ms, big-endian)
  const buf = new ArrayBuffer(8)
  new DataView(buf).setBigUint64(0, ts, false)
  const tsBytes = new Uint8Array(buf, 2, 6)

  // 4 bytes from SHA-256 of blob data
  const hashBuffer = await crypto.subtle.digest('SHA-256', blobData)
  const hashBytes = new Uint8Array(hashBuffer, 0, 4)

  // Combine: 6 + 4 = 10 bytes, encode as base58btc
  const tsidBytes = new Uint8Array(10)
  tsidBytes.set(tsBytes, 0)
  tsidBytes.set(hashBytes, 6)
  const tsid = base58btc.encode(tsidBytes)

  return `${authority}/${tsid}`
}
