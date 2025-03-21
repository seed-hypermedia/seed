import {
  Document,
  DocumentChange,
  DocumentChange_SetAttribute,
} from '../client/grpc-types'
import {GRPCClient} from '../grpc-client'
import {HMDocumentSchema} from '../hm-types'

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

  const templateDocuments = await client.documents.listDocuments({
    account: templateId,
  })

  for (const document of templateDocuments.documents) {
    const documentEntity = await client.documents.getDocument({
      account: templateId,
      path: document.path,
    })

    const doc = HMDocumentSchema.parse(documentEntity.toJson())

    console.log(`========= ~ Forking: doc:`, doc)
    let forkedDocument: Document | undefined
    try {
      forkedDocument = await client.documents.createDocumentChange({
        signingKeyName: targetId,
        account: targetId,
        path: document.path,
        changes: [
          new DocumentChange({
            op: {
              case: 'setAttribute',
              value: new DocumentChange_SetAttribute({
                blockId: '',
                key: ['name'],
                value: {
                  case: 'stringValue',
                  value: doc.metadata.name,
                },
              }),
            },
          }),
        ],
      })
    } catch (e) {
      console.error(`========= ~ Forking: error:`, e)
    }
    console.log(`========= ~ Forking: forkedDocument:`, forkedDocument)
  }
}
