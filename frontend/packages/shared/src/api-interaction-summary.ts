import {toPlainMessage} from '@bufbuild/protobuf'
import {HMRequestImplementation} from './api-types'
import {BIG_INT} from './constants'
import {GRPCClient} from './grpc-client'
import {HMInteractionSummaryRequest} from '@seed-hypermedia/client/hm-types'
import {calculateInteractionSummary} from './interaction-summary'
import {getErrorMessage, HMRedirectError} from './models/entity'
import {hmIdPathToEntityQueryPath} from './utils'

export const InteractionSummary: HMRequestImplementation<HMInteractionSummaryRequest> = {
  async getData(grpcClient: GRPCClient, input): Promise<HMInteractionSummaryRequest['output']> {
    const {id} = input

    const apiPath = hmIdPathToEntityQueryPath(id.path)

    try {
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
      const childrenCount = toPlainMessage(children).documents.filter((d) => {
        if (d.path === apiPath) return false
        // filter out children of children
        if (d.path.split('/').length > apiPath.split('/').length + 1) return false
        return true
      }).length

      return calculateInteractionSummary(mentions.mentions, changes.changes, id, childrenCount)
    } catch (e) {
      // If the document has been redirected, return empty summary.
      // queryResource handles following redirects, so this query will be
      // re-fetched with the correct (target) ID after redirect resolution.
      const err = getErrorMessage(e)
      if (err instanceof HMRedirectError) {
        return {citations: 0, comments: 0, changes: 0, children: 0, authorUids: [], blocks: {}}
      }
      throw e
    }
  },
}
