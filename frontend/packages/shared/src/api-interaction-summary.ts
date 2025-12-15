import {HMRequestImplementation} from './api-types'
import {BIG_INT} from './constants'
import {GRPCClient} from './grpc-client'
import {HMInteractionSummaryRequest} from './hm-types'
import {calculateInteractionSummary} from './interaction-summary'
import {hmIdPathToEntityQueryPath} from './utils'

export const InteractionSummary: HMRequestImplementation<HMInteractionSummaryRequest> =
  {
    async getData(
      grpcClient: GRPCClient,
      input,
    ): Promise<HMInteractionSummaryRequest['output']> {
      const {id} = input

      const apiPath = hmIdPathToEntityQueryPath(id.path)

      const [mentions, latestDoc, children] = await Promise.all([
        grpcClient.entities.listEntityMentions({
          id: id.id,
          pageSize: BIG_INT,
        }),
        grpcClient.documents.getDocument({
          account: id.uid,
          path: apiPath,
          version: undefined,
        }),
        grpcClient.documents.listDirectory({
          account: id.uid,
          directoryPath: apiPath,
        }),
      ])

      const changes = await grpcClient.documents.listDocumentChanges({
        account: id.uid,
        path: apiPath,
        version: latestDoc.version,
      })

      return calculateInteractionSummary(
        mentions.mentions,
        changes.changes,
        id,
        children.documents.length,
      )
    },
  }
