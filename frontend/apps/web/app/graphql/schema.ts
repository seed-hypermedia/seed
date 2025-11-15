import {grpcClient} from '@/client.server'
import SchemaBuilder from '@pothos/core'
import {
  ListCommentsRequest,
  Comment as ProtoComment,
} from '@shm/shared/client/.generated/documents/v3alpha/comments_pb'
import {
  GetAccountRequest,
  Account as ProtoAccount,
  Document as ProtoDocument,
} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {GetResourceRequest} from '@shm/shared/client/.generated/documents/v3alpha/resources_pb'
import type {GRPCClient} from '@shm/shared/grpc-client'
import {
  HMBlockNodeSchema,
  HMDocumentMetadataSchema,
  type HMBlockNode,
} from '@shm/shared/hm-types'

// Define backing models for our GraphQL types
interface DocumentModel {
  kind: 'document'
  iri: string
  version?: string
  data: ProtoDocument
}

interface CommentModel {
  kind: 'comment'
  iri: string
  version?: string
  data: ProtoComment
}

interface ProfileModel {
  accountId: string
  data: ProtoAccount
}

type ResourceModel = DocumentModel | CommentModel

// Define annotation types
interface LinkAnnotationType {
  type: string
  starts: number[]
  ends: number[]
  link?: string
}

interface SimpleAnnotationType {
  type: string
  starts: number[]
  ends: number[]
}

// Flattened block node structure
interface FlatBlockNode {
  block: HMBlockNode['block']
  childrenIds: string[]
  childrenType: string | null
}

interface BlocksContentData {
  blocks: FlatBlockNode[]
  rootBlockIds: string[]
}

// Create schema builder function that accepts grpcClient
export function createSchema(grpcClient: GRPCClient) {
  // Create the Pothos schema builder
  const builder = new SchemaBuilder<{
    Objects: {
      Document: DocumentModel
      Comment: CommentModel
      Profile: ProfileModel
      LinkAnnotation: LinkAnnotationType
      BoldAnnotation: SimpleAnnotationType
      ItalicAnnotation: SimpleAnnotationType
      UnderlineAnnotation: SimpleAnnotationType
      StrikeAnnotation: SimpleAnnotationType
      CodeAnnotation: SimpleAnnotationType
      ParagraphBlock: any
      HeadingBlock: any
      CodeBlock: any
      MathBlock: any
      ImageBlock: any
      VideoBlock: any
      FileBlock: any
      ButtonBlock: any
      EmbedBlock: any
      WebEmbedBlock: any
      NostrBlock: any
      BlockNode: FlatBlockNode
      BlocksContent: BlocksContentData
    }
    Interfaces: {
      Resource: ResourceModel
    }
  }>({})

  // Define Resource interface
  const ResourceInterface = builder.interfaceRef<ResourceModel>('Resource')
  ResourceInterface.implement({
    description: 'A Hypermedia resource',
    fields: (t) => ({
      iri: t.exposeString('iri', {
        description: 'The IRI (identifier) of the resource',
      }),
      version: t.string({
        description: 'The version of the resource',
        nullable: true,
        resolve: (resource) => resource.version || null,
      }),
    }),
  })

  // Define Profile type
  builder.objectType('Profile', {
    description: 'An account profile',
    fields: (t) => ({
      accountId: t.exposeString('accountId', {
        description: 'Account ID',
      }),
      name: t.string({
        description: 'Display name',
        nullable: true,
        resolve: (profile) => profile.data.profile?.name || null,
      }),
      home: t.field({
        type: 'Document',
        description: 'Home document for this profile',
        nullable: true,
        resolve: async (profile) => {
          const homeDoc = profile.data.homeDocumentInfo
          if (!homeDoc) return null

          // Create a minimal Document proto from DocumentInfo
          const doc = new ProtoDocument({
            account: homeDoc.account,
            path: homeDoc.path,
            metadata: homeDoc.metadata,
            authors: homeDoc.authors,
            content: [],
            createTime: homeDoc.createTime,
            updateTime: homeDoc.updateTime,
            genesis: homeDoc.genesis,
            version: homeDoc.version,
            generationInfo: homeDoc.generationInfo,
          })

          return {
            kind: 'document' as const,
            iri: `hm://${homeDoc.account}/${homeDoc.path}`,
            version: homeDoc.version,
            data: doc,
          }
        },
      }),
    }),
  })

  // Define Annotation types
  const AnnotationInterface = builder.interfaceRef<{
    type: string
    starts: number[]
    ends: number[]
  }>('Annotation')
  AnnotationInterface.implement({
    description: 'Text annotation (bold, italic, link, etc.)',
    resolveType: (annotation) => {
      // Map annotation types to their GraphQL type names
      const typeMap: Record<string, string> = {
        Bold: 'BoldAnnotation',
        Italic: 'ItalicAnnotation',
        Underline: 'UnderlineAnnotation',
        Strike: 'StrikeAnnotation',
        Code: 'CodeAnnotation',
        Link: 'LinkAnnotation',
      }
      return typeMap[annotation.type] || null
    },
    fields: (t) => ({
      type: t.exposeString('type'),
      starts: t.exposeIntList('starts'),
      ends: t.exposeIntList('ends'),
    }),
  })

  builder.objectType('LinkAnnotation', {
    interfaces: [AnnotationInterface],
    fields: (t) => ({
      link: t.exposeString('link', {nullable: true}),
    }),
  })

  builder.objectType('BoldAnnotation', {
    interfaces: [AnnotationInterface],
    fields: (t) => ({}),
  })
  builder.objectType('ItalicAnnotation', {
    interfaces: [AnnotationInterface],
    fields: (t) => ({}),
  })
  builder.objectType('UnderlineAnnotation', {
    interfaces: [AnnotationInterface],
    fields: (t) => ({}),
  })
  builder.objectType('StrikeAnnotation', {
    interfaces: [AnnotationInterface],
    fields: (t) => ({}),
  })
  builder.objectType('CodeAnnotation', {
    interfaces: [AnnotationInterface],
    fields: (t) => ({}),
  })

  // Define Block interface and types
  const BlockInterface = builder.interfaceRef<HMBlockNode['block']>('Block')
  BlockInterface.implement({
    description: 'Content block',
    resolveType: (block) => {
      // Map block types to their GraphQL type names
      const typeMap: Record<string, string> = {
        Paragraph: 'ParagraphBlock',
        Heading: 'HeadingBlock',
        Code: 'CodeBlock',
        Math: 'MathBlock',
        Image: 'ImageBlock',
        Video: 'VideoBlock',
        File: 'FileBlock',
        Button: 'ButtonBlock',
        Embed: 'EmbedBlock',
        WebEmbed: 'WebEmbedBlock',
        Nostr: 'NostrBlock',
      }
      return typeMap[block.type] || null
    },
    fields: (t) => ({
      id: t.exposeString('id'),
      type: t.exposeString('type'),
    }),
  })

  // Text blocks with annotations
  builder.objectType('ParagraphBlock', {
    interfaces: [BlockInterface],
    fields: (t) => ({
      text: t.string({resolve: (b: any) => b.text || ''}),
      annotations: t.field({
        type: [AnnotationInterface],
        resolve: (b: any) => b.annotations || [],
      }),
    }),
  })

  builder.objectType('HeadingBlock', {
    interfaces: [BlockInterface],
    fields: (t) => ({
      text: t.string({resolve: (b: any) => b.text || ''}),
      annotations: t.field({
        type: [AnnotationInterface],
        resolve: (b: any) => b.annotations || [],
      }),
    }),
  })

  builder.objectType('CodeBlock', {
    interfaces: [BlockInterface],
    fields: (t) => ({
      text: t.string({resolve: (b: any) => b.text || ''}),
      language: t.string({
        nullable: true,
        resolve: (b: any) => b.attributes?.language || null,
      }),
    }),
  })

  builder.objectType('MathBlock', {
    interfaces: [BlockInterface],
    fields: (t) => ({
      text: t.string({resolve: (b: any) => b.text || ''}),
    }),
  })

  // Media blocks
  builder.objectType('ImageBlock', {
    interfaces: [BlockInterface],
    fields: (t) => ({
      link: t.exposeString('link'),
      text: t.string({resolve: (b: any) => b.text || ''}),
      width: t.int({
        nullable: true,
        resolve: (b: any) => b.attributes?.width || null,
      }),
      name: t.string({
        nullable: true,
        resolve: (b: any) => b.attributes?.name || null,
      }),
    }),
  })

  builder.objectType('VideoBlock', {
    interfaces: [BlockInterface],
    fields: (t) => ({
      link: t.exposeString('link'),
      width: t.int({
        nullable: true,
        resolve: (b: any) => b.attributes?.width || null,
      }),
      name: t.string({
        nullable: true,
        resolve: (b: any) => b.attributes?.name || null,
      }),
    }),
  })

  builder.objectType('FileBlock', {
    interfaces: [BlockInterface],
    fields: (t) => ({
      link: t.exposeString('link'),
      size: t.int({
        nullable: true,
        resolve: (b: any) => b.attributes?.size || null,
      }),
      name: t.string({
        nullable: true,
        resolve: (b: any) => b.attributes?.name || null,
      }),
    }),
  })

  // Interactive blocks
  builder.objectType('ButtonBlock', {
    interfaces: [BlockInterface],
    fields: (t) => ({
      link: t.exposeString('link'),
      text: t.string({nullable: true, resolve: (b: any) => b.text || null}),
      alignment: t.string({
        nullable: true,
        resolve: (b: any) => b.attributes?.alignment || null,
      }),
    }),
  })

  builder.objectType('EmbedBlock', {
    interfaces: [BlockInterface],
    fields: (t) => ({
      link: t.exposeString('link'),
      view: t.string({
        nullable: true,
        resolve: (b: any) => b.attributes?.view || null,
      }),
      // Resolve embedded resource
      resource: t.field({
        type: ResourceInterface,
        nullable: true,
        description: 'The embedded resource if link is a hm:// URL',
        resolve: async (b: any) => {
          const link = b.link
          if (!link || !link.startsWith('hm://')) return null

          try {
            const request = new GetResourceRequest({iri: link})
            const response = await grpcClient.resources.getResource(request)

            if (response.kind.case === 'document') {
              return {
                kind: 'document' as const,
                iri: link,
                version: response.version,
                data: response.kind.value,
              }
            } else if (response.kind.case === 'comment') {
              return {
                kind: 'comment' as const,
                iri: link,
                version: response.version,
                data: response.kind.value,
              }
            }
            return null
          } catch (err) {
            console.warn('Failed to resolve embed resource:', link, err)
            return null
          }
        },
      }),
    }),
  })

  builder.objectType('WebEmbedBlock', {
    interfaces: [BlockInterface],
    fields: (t) => ({
      link: t.exposeString('link'),
    }),
  })

  builder.objectType('NostrBlock', {
    interfaces: [BlockInterface],
    fields: (t) => ({
      link: t.exposeString('link'),
    }),
  })

  // BlockNode with childrenIds instead of nested children
  const BlockNodeRef = builder.objectRef<FlatBlockNode>('BlockNode')
  BlockNodeRef.implement({
    fields: (t) => ({
      block: t.field({
        type: BlockInterface,
        resolve: (node) => node.block,
      }),
      childrenIds: t.stringList({
        description: 'IDs of child blocks',
        resolve: (node) => node.childrenIds,
      }),
      childrenType: t.string({
        nullable: true,
        description:
          'Type of children collection (Group, Ordered, Unordered, Blockquote)',
        resolve: (node) => node.childrenType,
      }),
    }),
  })

  // BlocksContent type for flattened content structure
  const BlocksContentRef = builder.objectRef<BlocksContentData>('BlocksContent')
  BlocksContentRef.implement({
    description: 'Flattened content blocks structure',
    fields: (t) => ({
      blocks: t.field({
        type: [BlockNodeRef],
        description: 'Flat list of all blocks by ID',
        resolve: (content) => content.blocks,
      }),
      rootBlockIds: t.stringList({
        description: 'IDs of top-level blocks',
        resolve: (content) => content.rootBlockIds,
      }),
    }),
  })

  // Define Document type
  builder.objectType('Document', {
    description: 'A document resource',
    interfaces: [ResourceInterface],
    isTypeOf: (obj): obj is DocumentModel =>
      (obj as ResourceModel).kind === 'document',
    fields: (t) => ({
      account: t.string({
        description: 'Account ID where the document is located',
        resolve: (doc) => doc.data.account,
      }),
      path: t.string({
        description: 'Path of the document within the account',
        resolve: (doc) => doc.data.path,
      }),
      name: t.string({
        resolve: (doc) =>
          HMDocumentMetadataSchema.parse(
            doc.data.metadata?.toJson({emitDefaultValues: true}),
          ).name,
      }),
      content: t.field({
        type: BlocksContentRef,
        description: 'Document content as flattened block structure',
        resolve: (doc) => {
          // Convert proto BlockNodes to plain objects and validate
          const plainNodes = doc.data.content.map((node) =>
            node.toJson({emitDefaultValues: true}),
          )

          const validatedNodes: HMBlockNode[] = []
          for (const plainNode of plainNodes) {
            const result = HMBlockNodeSchema.safeParse(plainNode)
            if (result.success) {
              validatedNodes.push(result.data)
            } else {
              console.warn('Invalid block node in document content:', {
                error: result.error,
                node: plainNode,
              })
            }
          }

          // Flatten the recursive tree structure
          const flatBlocks: FlatBlockNode[] = []
          const rootBlockIds: string[] = []

          function flattenNode(node: HMBlockNode) {
            const childrenIds = (node.children || []).map((child) => {
              flattenNode(child)
              return child.block.id
            })

            // Extract childrenType from block attributes if available
            let childrenType: string | null = null
            if ('attributes' in node.block && node.block.attributes) {
              const attrs = node.block.attributes as any
              if (attrs.childrenType) {
                childrenType = attrs.childrenType
              }
            }

            flatBlocks.push({
              block: node.block,
              childrenIds,
              childrenType,
            })
          }

          // Flatten all root nodes
          for (const node of validatedNodes) {
            flattenNode(node)
            rootBlockIds.push(node.block.id)
          }

          return {
            blocks: flatBlocks,
            rootBlockIds,
          }
        },
      }),
      // Add discussions field to fetch comments for this document
      discussions: t.field({
        type: ['Comment'],
        description: 'Comments/discussions on this document',
        args: {
          pageSize: t.arg.int({required: false}),
          pageToken: t.arg.string({required: false}),
        },
        resolve: async (doc, args) => {
          const request = new ListCommentsRequest({
            targetAccount: doc.data.account,
            targetPath: doc.data.path,
            pageSize: args.pageSize || 50,
            pageToken: args.pageToken || '',
          })

          const response = await grpcClient.comments.listComments(request)

          return response.comments.map((comment) => ({
            kind: 'comment' as const,
            iri: `hm://${comment.author}/${comment.targetPath}?v=${comment.version}`,
            version: comment.version,
            data: comment,
          }))
        },
      }),
    }),
  })

  // Define Comment type
  builder.objectType('Comment', {
    description: 'A comment resource',
    interfaces: [ResourceInterface],
    isTypeOf: (obj): obj is CommentModel =>
      (obj as ResourceModel).kind === 'comment',
    fields: (t) => ({
      id: t.string({
        description: 'ID of the comment',
        resolve: (comment) => comment.data.id,
      }),
      authorId: t.string({
        description: 'Author account ID',
        resolve: (comment) => comment.data.author,
      }),
      author: t.field({
        type: 'Profile',
        description: 'Author profile',
        resolve: async (comment) => {
          const request = new GetAccountRequest({
            id: comment.data.author,
          })

          const account = await grpcClient.documents.getAccount(request)

          return {
            accountId: comment.data.author,
            data: account,
          }
        },
      }),
      targetAccount: t.string({
        description: 'Target document account',
        resolve: (comment) => comment.data.targetAccount,
      }),
      targetPath: t.string({
        description: 'Target document path',
        resolve: (comment) => comment.data.targetPath,
      }),
      replyParent: t.string({
        description: 'ID of parent comment if this is a reply',
        nullable: true,
        resolve: (comment) => comment.data.replyParent || null,
      }),
      content: t.field({
        type: BlocksContentRef,
        description: 'Comment content as flattened block structure',
        resolve: (comment) => {
          // Convert proto BlockNodes to plain objects and validate
          const plainNodes = comment.data.content.map((node) =>
            node.toJson({emitDefaultValues: true}),
          )

          const validatedNodes: HMBlockNode[] = []
          for (const plainNode of plainNodes) {
            const result = HMBlockNodeSchema.safeParse(plainNode)
            if (result.success) {
              validatedNodes.push(result.data)
            } else {
              console.warn('Invalid block node in comment content:', {
                error: result.error,
                node: plainNode,
              })
            }
          }

          // Flatten the recursive tree structure
          const flatBlocks: FlatBlockNode[] = []
          const rootBlockIds: string[] = []

          function flattenNode(node: HMBlockNode) {
            const childrenIds = (node.children || []).map((child) => {
              flattenNode(child)
              return child.block.id
            })

            // Extract childrenType from block attributes if available
            let childrenType: string | null = null
            if ('attributes' in node.block && node.block.attributes) {
              const attrs = node.block.attributes as any
              if (attrs.childrenType) {
                childrenType = attrs.childrenType
              }
            }

            flatBlocks.push({
              block: node.block,
              childrenIds,
              childrenType,
            })
          }

          // Flatten all root nodes
          for (const node of validatedNodes) {
            flattenNode(node)
            rootBlockIds.push(node.block.id)
          }

          return {
            blocks: flatBlocks,
            rootBlockIds,
          }
        },
      }),
    }),
  })

  // Define the Query type
  builder.queryType({
    fields: (t) => ({
      // Health check query
      hello: t.string({
        description: 'Simple health check query',
        resolve: () => 'Hello from Seed GraphQL API',
      }),

      // getResource query returns Resource interface
      getResource: t.field({
        type: ResourceInterface,
        description: 'Get a resource by its IRI',
        args: {
          iri: t.arg.string({
            required: true,
            description: 'The IRI of the resource to retrieve',
          }),
        },
        resolve: async (_parent, args) => {
          // Create the gRPC request
          const request = new GetResourceRequest({
            iri: args.iri,
          })

          // Call the gRPC service
          const response = await grpcClient.resources.getResource(request)

          // Map the gRPC response to our GraphQL ResourceModel
          if (response.kind.case === 'document') {
            return {
              kind: 'document' as const,
              iri: args.iri,
              version: response.version,
              data: response.kind.value,
            }
          } else if (response.kind.case === 'comment') {
            return {
              kind: 'comment' as const,
              iri: args.iri,
              version: response.version,
              data: response.kind.value,
            }
          }

          // Handle contact or unknown types
          throw new Error(`Unsupported resource type: ${response.kind.case}`)
        },
      }),
    }),
  })

  // Build and return the schema
  return builder.toSchema()
}

export const graphQLSchema = createSchema(grpcClient)
