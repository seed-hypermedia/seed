import {
  HMAccountsMetadata,
  HMQueryBlockItemSummary,
  HMQueryBlockRequest,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {GRPCClient} from './grpc-client'
import {hmIdPathToEntityQueryPath} from './utils/path-api'
import {hmId} from './utils'
import {HMRequestImplementation} from './api-types'
import {createQueryResolver} from './models/directory'
import {loadAccount} from './api-account'

function readMetadataStringField(
  metadata: {toJson: (opts: {emitDefaultValues: boolean; enumAsInteger: boolean}) => unknown} | undefined,
  field: 'name' | 'icon',
) {
  const metadataJson = (metadata?.toJson({emitDefaultValues: true, enumAsInteger: false}) || {}) as Record<
    string,
    unknown
  >
  const value = metadataJson[field]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function nonEmptyString(value: string | undefined) {
  return value && value.trim() ? value : undefined
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function roundMs(value: number) {
  return Math.round(value * 10) / 10
}

function createInstrumentedGRPCClient(
  grpcClient: GRPCClient,
  grpcRequests: Record<string, {count: number; errorCount: number; totalMs: number}>,
): GRPCClient {
  return Object.fromEntries(
    Object.entries(grpcClient).map(([serviceName, serviceClient]) => [
      serviceName,
      new Proxy(serviceClient as object, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver)
          if (typeof value !== 'function') return value

          return async (...args: Array<unknown>) => {
            const methodName = `${serviceName}.${String(prop)}`
            const requestMetric =
              grpcRequests[methodName] ||
              (grpcRequests[methodName] = {
                count: 0,
                errorCount: 0,
                totalMs: 0,
              })
            requestMetric.count += 1
            const startedAt = now()

            try {
              return await value.apply(target, args)
            } catch (error) {
              requestMetric.errorCount += 1
              throw error
            } finally {
              requestMetric.totalMs += now() - startedAt
            }
          }
        },
      }),
    ]),
  ) as GRPCClient
}

async function loadQueryTargetName(grpcClient: GRPCClient, id: UnpackedHypermediaId) {
  try {
    const docInfo = await grpcClient.documents.getDocumentInfo({
      account: id.uid,
      path: hmIdPathToEntityQueryPath(id.path),
    })
    return readMetadataStringField(docInfo.metadata, 'name') ?? id.path?.[id.path.length - 1] ?? id.uid
  } catch {
    return id.path?.[id.path.length - 1] ?? id.uid
  }
}

function getQueryBlockItemSummary(item: {activitySummary?: {commentCount?: number}}): HMQueryBlockItemSummary {
  return {
    comments: item.activitySummary?.commentCount ?? 0,
    authorUids: [],
  }
}

async function loadVisibleAccountsMetadata(
  grpcClient: GRPCClient,
  visibleContributorUids: string[],
): Promise<{accountsMetadata: HMAccountsMetadata; fallbackCount: number}> {
  if (!visibleContributorUids.length) return {accountsMetadata: {}, fallbackCount: 0}

  const batch = await grpcClient.documents.batchGetAccounts({ids: visibleContributorUids})
  const accountsMetadata: HMAccountsMetadata = {}
  const fallbackUids: string[] = []

  visibleContributorUids.forEach((uid) => {
    const account = batch.accounts[uid]
    if (!account || account.aliasAccount) {
      fallbackUids.push(uid)
      return
    }

    const name =
      nonEmptyString(account.profile?.name) ??
      readMetadataStringField(account.homeDocumentInfo?.metadata || account.metadata, 'name')
    const icon =
      nonEmptyString(account.profile?.icon) ??
      readMetadataStringField(account.homeDocumentInfo?.metadata || account.metadata, 'icon')

    accountsMetadata[uid] = {
      id: hmId(uid, {
        version: account.homeDocumentInfo?.version,
      }),
      metadata: {
        ...(name ? {name} : {}),
        ...(icon ? {icon} : {}),
      },
    }
  })

  for (const uid of fallbackUids) {
    const account = await loadAccount(grpcClient, uid)
    if (account.type === 'account') {
      accountsMetadata[uid] = {
        id: account.id,
        metadata: {
          ...(account.metadata?.name ? {name: account.metadata.name} : {}),
          ...(account.metadata?.icon ? {icon: account.metadata.icon} : {}),
        },
      }
    }
  }

  return {accountsMetadata, fallbackCount: fallbackUids.length}
}

/**
 * Loads everything needed to render a query block in one API request.
 */
export const QueryBlock: HMRequestImplementation<HMQueryBlockRequest> = {
  async getData(grpcClient: GRPCClient, input): Promise<HMQueryBlockRequest['output']> {
    const startedAt = now()
    const perf = {
      status: 'success' as 'success' | 'empty' | 'error',
      resolvedItemCount: 0,
      returnedItemCount: 0,
      visibleContributorCount: 0,
      fallbackAccountCount: 0,
      phaseDurationsMs: {
        queryResolver: 0,
        queryTargetName: 0,
        itemSummaries: 0,
        accountsMetadata: 0,
      },
      grpcRequests: {} as Record<string, {count: number; errorCount: number; totalMs: number}>,
      error: undefined as string | undefined,
    }
    const instrumentedGrpcClient = createInstrumentedGRPCClient(grpcClient, perf.grpcRequests)

    try {
      const getQueryResults = createQueryResolver(instrumentedGrpcClient)

      const queryResolverStartedAt = now()
      const queryResult = await getQueryResults(input.query)
      perf.phaseDurationsMs.queryResolver += now() - queryResolverStartedAt
      if (!queryResult) {
        perf.status = 'empty'
        return null
      }

      perf.resolvedItemCount = queryResult.results.length
      const limit = input.query.limit
      const results = limit && limit > 0 ? queryResult.results.slice(0, limit) : queryResult.results
      perf.returnedItemCount = results.length

      const queryTargetNameStartedAt = now()
      const queryTargetName = await loadQueryTargetName(instrumentedGrpcClient, queryResult.in)
      perf.phaseDurationsMs.queryTargetName += now() - queryTargetNameStartedAt

      const interactionSummaries: Record<string, HMQueryBlockItemSummary> = {}
      const visibleContributorUids = new Set<string>()

      const itemSummariesStartedAt = now()
      for (const item of results) {
        const summary = getQueryBlockItemSummary(item)
        interactionSummaries[item.id.id] = summary

        const contributorUids = Array.from(new Set(item.authors))
        contributorUids.slice(0, 3).forEach((uid) => visibleContributorUids.add(uid))
      }
      perf.phaseDurationsMs.itemSummaries += now() - itemSummariesStartedAt
      perf.visibleContributorCount = visibleContributorUids.size

      const accountsMetadataStartedAt = now()
      const {accountsMetadata, fallbackCount} = await loadVisibleAccountsMetadata(
        instrumentedGrpcClient,
        Array.from(visibleContributorUids),
      )
      perf.phaseDurationsMs.accountsMetadata += now() - accountsMetadataStartedAt
      perf.fallbackAccountCount = fallbackCount

      return {
        queryTargetName,
        in: queryResult.in,
        mode: queryResult.mode,
        results,
        interactionSummaries,
        accountsMetadata,
      }
    } catch (error) {
      perf.status = 'error'
      perf.error = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      const grpcRequestEntries = Object.entries(perf.grpcRequests).sort((a, b) => b[1].totalMs - a[1].totalMs)
      const totalGrpcRequestCount = grpcRequestEntries.reduce((sum, [, request]) => sum + request.count, 0)
      const phaseEntries = Object.entries(perf.phaseDurationsMs).sort((a, b) => b[1] - a[1])
      const totalMs = now() - startedAt

      console.info(
        '[QueryBlock perf]',
        JSON.stringify({
          status: perf.status,
          query: {
            includes: input.query.includes.map(({space, path, mode}) => ({space, path, mode})),
            limit: input.query.limit ?? null,
            sortCount: input.query.sort?.length ?? 0,
          },
          resolvedItemCount: perf.resolvedItemCount,
          returnedItemCount: perf.returnedItemCount,
          visibleContributorCount: perf.visibleContributorCount,
          fallbackAccountCount: perf.fallbackAccountCount,
          phaseDurationsMs: {
            total: roundMs(totalMs),
            queryResolver: roundMs(perf.phaseDurationsMs.queryResolver),
            queryTargetName: roundMs(perf.phaseDurationsMs.queryTargetName),
            itemSummaries: roundMs(perf.phaseDurationsMs.itemSummaries),
            accountsMetadata: roundMs(perf.phaseDurationsMs.accountsMetadata),
          },
          itemSummaryMetrics: {
            count: perf.returnedItemCount,
            totalMs: roundMs(perf.phaseDurationsMs.itemSummaries),
            avgMs: perf.returnedItemCount ? roundMs(perf.phaseDurationsMs.itemSummaries / perf.returnedItemCount) : 0,
          },
          grpcRequests: {
            totalCount: totalGrpcRequestCount,
            byMethod: Object.fromEntries(
              grpcRequestEntries.map(([methodName, request]) => [
                methodName,
                {
                  count: request.count,
                  errorCount: request.errorCount,
                  totalMs: roundMs(request.totalMs),
                  avgMs: request.count ? roundMs(request.totalMs / request.count) : 0,
                },
              ]),
            ),
          },
          topGrpcMethodsByTime: grpcRequestEntries.slice(0, 5).map(([methodName, request]) => ({
            method: methodName,
            count: request.count,
            totalMs: roundMs(request.totalMs),
          })),
          topPhasesByTime: phaseEntries.map(([phase, durationMs]) => ({
            phase,
            totalMs: roundMs(durationMs),
            percentOfTotal: totalMs > 0 ? roundMs((durationMs / totalMs) * 100) : 0,
          })),
          ...(perf.error ? {error: perf.error} : {}),
        }),
      )
    }
  },
}
