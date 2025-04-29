import {grpcClient} from '@/grpc-client'
import {toPlainMessage} from '@bufbuild/protobuf'
import {BIG_INT, blockAnnotations, hmIdPathToEntityQueryPath} from '@shm/shared'
import {
  HMBlock,
  HMBlockNode,
  HMDocumentSchema,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {documentParseAdjustments} from '@shm/shared/models/entity'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useQuery} from '@tanstack/react-query'
import {diffWords} from 'diff'
import {ChangeData, queryBlob} from './changes'

export function useDocumentBlame(
  id?: UnpackedHypermediaId,
  opts: {shallow?: boolean; enabled?: boolean} = {
    shallow: false,
    enabled: true,
  },
) {
  return useQuery({
    queryKey: [queryKeys.DOCUMENT_BLAME, id?.id, id?.version, opts.shallow],
    enabled: opts.enabled,
    queryFn: async () => {
      if (!id) return null
      const docApiQuery = {
        account: id.uid,
        path: hmIdPathToEntityQueryPath(id.path),
        version: id.version || '',
      } as const
      const result = await grpcClient.documents.listDocumentChanges({
        ...docApiQuery,
        pageSize: BIG_INT,
      })
      const changes = result.changes.map(toPlainMessage)
      const document = await grpcClient.documents.getDocument({
        ...docApiQuery,
      })
      const unparsedDocument = document.toJson()
      documentParseAdjustments(unparsedDocument)
      const resultDocument = HMDocumentSchema.parse(unparsedDocument)
      const blockMap = extractBlockIdMap(resultDocument.content)
      console.log('~~~ blockMap', blockMap)
      const fullChanges = await Promise.all(
        // Most recent changes have LOWER index
        changes.map(async (change) => {
          const blob = await queryBlob(change.id).queryFn()
          return blob
          //   return await grpcClient.entities.getChange({ // not implemented
          //     id: change.id,
          //   })
        }),
      )
      console.log('~~~ full changes', fullChanges)
      const blockReplaceOperations: Record<
        string,
        {change: ChangeData; op: any}[]
      > = Object.fromEntries(
        Object.entries(blockMap).map(([blockId, block]) => {
          const changeOps: {change: ChangeData; op: any}[] = []
          fullChanges.forEach((fullChange) => {
            fullChange.body?.ops.forEach((op) => {
              // console.log('~~~ op', op)
              if (op.type === 'ReplaceBlock' && op.block.id === blockId) {
                changeOps.push({change: fullChange, op})
              }
            })
          })
          return [blockId, changeOps]
        }),
      )
      console.log('~~~ blockReplaceOperations', blockReplaceOperations)

      Object.entries(blockReplaceOperations).forEach(
        ([blockId, replaceOps]) => {
          //   if (
          //     opts.shallow &&
          //     !blockIdIsInVersion(blockId, resultDocument.version)
          //   ) {
          //     return
          //   }
          const block = blockMap[blockId]
          const prevBlock = replaceOps[1]
          //   if (!prevBlock) {
          //     const annotations = blockAnnotations(block)
          //     annotations?.push({
          //       type: 'Added',
          //       starts: [0],
          //       ends: [block.text?.length || 0],
          //     })
          //     return
          //   }
          const blockTextDiff = diffWords(
            prevBlock?.op.block.text || '',
            block.text || '',
            {},
          )
          let position = 0
          let text = ''
          const annotations = blockAnnotations(block)
          blockTextDiff.forEach((diffResult) => {
            if (diffResult.added) {
              annotations?.push({
                type: 'Added',
                starts: [position],
                ends: [position + diffResult.value.length],
              })
            } else if (diffResult.removed) {
              annotations?.push({
                type: 'Removed',
                starts: [position],
                ends: [position + diffResult.value.length],
              })
            } else {
            }
            position += diffResult.value.length
            text += diffResult.value
          })
          block.text = text
          //   if (annotations) {
          //     annotations.push({
          //       type: 'Added',
          //       starts: [4],
          //       ends: [10],
          //     })
          //     annotations.push({
          //       type: 'Removed',
          //       starts: [11],
          //       ends: [18],
          //     })
          //   }
          console.log('~~~ COMPARE BLOCK', block, blockTextDiff, annotations)
        },
      )

      //   console.log(
      //     '~~~ full changes TS',
      //     fullChanges.map((change) => change?.ts),
      //   )

      console.log('~~~ resultDocument', resultDocument)
      return {document: resultDocument}
    },
  })
}

function extractBlockIdMap(content: HMBlockNode[]): Record<string, HMBlock> {
  const blockMap: Record<string, HMBlock> = {}
  content.forEach((bn) => extractBlockIdMapNode(bn, blockMap))
  return blockMap
}

function extractBlockIdMapNode(
  node: HMBlockNode,
  blockMap: Record<string, HMBlock>,
) {
  if (node.block?.id) {
    blockMap[node.block?.id] = node.block
  }
  if (node.children) {
    node.children.forEach((bn) => extractBlockIdMapNode(bn, blockMap))
  }
}

function blockIdIsInVersion(blockId: string, version: string) {
  return version.split('.').includes(blockId)
}
