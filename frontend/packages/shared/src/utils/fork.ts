import {Struct} from '@bufbuild/protobuf'
import {DocumentChange} from '../client'
import {GRPCClient} from '../grpc-client'
import {HMBlockNode, HMDocumentSchema} from '../hm-types'
import {
  BlocksMap,
  createBlocksMap,
  getDocAttributeChanges,
} from './document-changes'

export async function cloneSiteFromTemplate({
  client,
  targetId,
  templateId,
}: {
  client: GRPCClient
  targetId: string
  templateId: string
}) {
  console.log(
    `[Fork] Starting fork process from template ${templateId} to target ${targetId}`,
  )

  /**
   * - get the template Entity
   * - get the target home document
   * - update the target home document with the template home document content and metadata
   * - get all document entities in the template
   * - create each document from the template entity in the target site
   *   - set all document changes for all metadata
   *   - create a blocksMap from the template document
   *   - create documentChanges for each block (move and replace)
   */

  try {
    console.log('[Fork] Fetching target home document...')
    const targetHomeDoc = await client.documents.getDocument({
      account: targetId,
      path: '',
    })
    console.log(`[Fork] Target home document version: ${targetHomeDoc.version}`)

    const targetHomeDocEntity = HMDocumentSchema.parse(targetHomeDoc.toJson())

    console.log('[Fork] Fetching template home document...')
    const templateHomeDoc = await client.documents.getDocument({
      account: templateId,
    })
    const templateHomeDocEntity = HMDocumentSchema.parse(
      templateHomeDoc.toJson(),
    )
    console.log('[Fork] Template home document parsed successfully')

    // remove the template name so it will not override the current target name
    delete templateHomeDocEntity.metadata.name

    // remove the template icon so it will not override the current target icon
    if (targetHomeDocEntity.metadata.icon) {
      delete templateHomeDocEntity.metadata.icon
    }

    // remove the template experimental logo so it will not override the current target experimental logo
    if (targetHomeDocEntity.metadata.seedExperimentalLogo) {
      delete templateHomeDocEntity.metadata.seedExperimentalLogo
    }

    console.log('[Fork] Creating blocks map for template home document...')
    const blocksMap = createBlocksMap(templateHomeDocEntity.content, '')
    console.log(
      `[Fork] Blocks map created with ${Object.keys(blocksMap).length} blocks`,
    )

    console.log('[Fork] Applying changes to target home document...')
    await client.documents.createDocumentChange({
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
    console.log('[Fork] Target home document updated successfully')
  } catch (error) {
    console.error(`[Fork] Error updating home document:`, error)
    throw error
  }

  console.log('[Fork] Fetching template documents...')
  const templateDocuments = await client.documents.listDocuments({
    account: templateId,
  })
  const documentsToProcess = templateDocuments.documents.filter(
    (doc) => doc.path !== '',
  )
  console.log(
    `[Fork] Found ${documentsToProcess.length} documents to process (excluding home document)`,
  )

  for (const document of documentsToProcess) {
    try {
      console.log(`[Fork] Processing document: ${document.path}`)
      const documentEntity = await client.documents.getDocument({
        account: templateId,
        path: document.path,
      })
      const doc = HMDocumentSchema.parse(documentEntity.toJson())
      console.log(`[Fork] Document ${document.path} parsed successfully`)

      const blocksMap = createBlocksMap(doc.content, '')
      console.log(
        `[Fork] Created blocks map for ${document.path} with ${
          Object.keys(blocksMap).length
        } blocks`,
      )

      await client.documents.createDocumentChange({
        signingKeyName: targetId,
        account: targetId,
        path: document.path,
        changes: [
          ...getDocAttributeChanges(doc.metadata),
          ...getBlockNodeChanges(targetId, doc.content, blocksMap),
        ],
      })
      console.log(`[Fork] Successfully created document: ${document.path}`)
    } catch (e) {
      console.error(`[Fork] Error processing document ${document.path}:`, e)
      throw e
    }
  }
  console.log('[Fork] Fork process completed successfully')
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

    if (bn.block.type == 'Button') {
      console.log('[Fork] Processing Button block:')
      console.log(`[Fork] Original link: ${bn.block.link}`)
      bn.block.link = bn.block.link.replace(
        /hm:\/\/([^/]+)/,
        `hm://${targetId}`,
      )
      console.log(`[Fork] New link: ${bn.block.link}`)
      console.log(`[Fork] Target ID used: ${targetId}`)
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
