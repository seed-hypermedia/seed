import {grpcClient} from '@/client'
import {parseRequest} from '@/request'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {toPlainMessage} from '@bufbuild/protobuf'
import {ConnectError, Code} from '@connectrpc/connect'
import {Params} from '@remix-run/react'
import {
  Account,
  HMDocumentMetadataSchema,
  hmId,
  HMMetadataPayload,
} from '@shm/shared'

async function getAccount(accountUid: string) {
  // We follow account redirects here until we reach the final account,
  // or the limit of redirects is reached.

  // Arbitrary limit to prevent absurdly long account redirect chains.
  const maxAccountRedirects = 100

  const visited = new Set<string>()

  // Final account after following redirects.
  let grpcAccount: Account | undefined
  for (let i = 0; i <= maxAccountRedirects; i++) {
    grpcAccount = await grpcClient.documents.getAccount({
      id: accountUid,
    })

    if (!grpcAccount.aliasAccount) {
      break
    }

    if (visited.has(grpcAccount.aliasAccount)) {
      throw new Error(`Account redirect cycle detected`)
    }

    if (i === maxAccountRedirects) {
      throw new Error(
        `Account redirect chain is too long (${maxAccountRedirects})`,
      )
    }

    visited.add(grpcAccount.aliasAccount)
    accountUid = grpcAccount.aliasAccount
  }

  // This should never happen, because gRPC error would have been thrown before,
  // but TS compile is unhappy without this check.
  if (!grpcAccount) {
    throw new Error(`Unreachable: Account not found`)
  }

  const serverAccount = toPlainMessage(grpcAccount)
  if (serverAccount.aliasAccount) {
    return await getAccount(serverAccount.aliasAccount)
  }
  const serverMetadata = grpcAccount.metadata?.toJson() || {}
  const metadata = HMDocumentMetadataSchema.parse(serverMetadata)
  return {
    id: hmId(accountUid),
    metadata,
  } as HMMetadataPayload
}

export const loader = async ({
  request,
  params,
}: {
  request: Request
  params: Params
}): Promise<WrappedResponse<HMMetadataPayload>> => {
  const parsedRequest = parseRequest(request)
  const {url} = parsedRequest
  const accountUid = params['*']
  if (!accountUid) {
    throw new Error('No account uid provided')
  }

  try {
    const account = await getAccount(accountUid)
    return wrapJSON(account)
  } catch (err) {
    if (err instanceof ConnectError && err.code === Code.NotFound) {
      return wrapJSON(err, {
        status: 404,
        statusText: 'Not Found',
      })
    }
    throw err
  }
}
