import {Struct} from '@bufbuild/protobuf'
import {DocumentChange} from '../client'
import {GRPCClient} from '../grpc-client'
import {HMBlockNode, HMDocumentSchema} from '../hm-types'
import {
  BlocksMap,
  createBlocksMap,
  getDocAttributeChanges,
} from './document-changes'

export async function forkSitefromTemplate({
  client,
  targetId,
  templateId,
}: {
  client: GRPCClient
  targetId: string
  templateId: string
}) {
  /**
   * - get the template Entity
   * - get all document entities in the template
   * - create each document from the template entity in the target site
   *   - set all document changes for all metadata
   *   - create a blocksMap from the template document
   *   - create documentChanges for each block (move and replace)
   */

  try {
    const targetHomeDoc = await client.documents.getDocument({
      account: targetId,
      path: '',
    })

    const templateHomeDoc = await client.documents.getDocument({
      account: templateId,
    })
    const templateHomeDocEntity = HMDocumentSchema.parse(
      templateHomeDoc.toJson(),
    )

    console.log(`== ~ templateHomeDocEntity:`, templateHomeDocEntity)
    delete templateHomeDocEntity.metadata.name
    const blocksMap = createBlocksMap(templateHomeDocEntity.content, '')
    let targetHomeDocChange = await client.documents.createDocumentChange({
      signingKeyName: targetId,
      account: targetId,
      baseVersion: targetHomeDoc.version,
      path: '',
      changes: [
        ...getDocAttributeChanges(templateHomeDocEntity.metadata),
        ...getBlockNodeChanges(
          targetId,
          templateHomeDocEntity.content,
          blocksMap,
        ),
      ],
    })

    console.log(`== ~ targetHomeDocChange:`, targetHomeDocChange)
  } catch (error) {
    console.error(`========= ~ Home Doc Fork: error:`, error)
  }

  const templateDocuments = await client.documents.listDocuments({
    account: templateId,
  })

  for (const document of templateDocuments.documents) {
    try {
      const documentEntity = await client.documents.getDocument({
        account: templateId,
        path: document.path,
      })
      const doc = HMDocumentSchema.parse(documentEntity.toJson())
      const blocksMap = createBlocksMap(doc.content, '')
      await client.documents.createDocumentChange({
        signingKeyName: targetId,
        account: targetId,
        path: document.path,
        changes: [
          ...getDocAttributeChanges(doc.metadata),
          ...getBlockNodeChanges(targetId, doc.content, blocksMap),
        ],
      })
    } catch (e) {
      console.error(`========= ~ Forking: error: ${document.path}`, e)
    }
  }
}

function getBlockNodeChanges(
  targetId: string,
  blockNodes: HMBlockNode[],
  blocksMap: BlocksMap,
) {
  let changes: Array<DocumentChange> = []
  for (const bn of blockNodes) {
    if (bn.block.type == 'Query') {
      // change space id to the targetId
      bn.block.attributes.query.includes[0].space = targetId
    }
    changes.push(
      new DocumentChange({
        op: {
          case: 'moveBlock',
          value: {
            parent: blocksMap[bn.block.id].parent,
            leftSibling: blocksMap[bn.block.id].left,
            blockId: bn.block.id,
          },
        },
      }),
      new DocumentChange({
        op: {
          case: 'replaceBlock',
          value: {
            ...bn.block,
            attributes: bn.block.attributes
              ? Struct.fromJson(bn.block.attributes)
              : {},
          },
        },
      }),
    )

    if (bn.children?.length) {
      changes.push(...getBlockNodeChanges(targetId, bn.children, blocksMap))
    }
  }
  return changes
}
