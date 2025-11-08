import {grpcClient} from '@/client.server'
import {parseRequest} from '@/request'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {toPlainMessage} from '@bufbuild/protobuf'
import {ConnectError, Code} from '@connectrpc/connect'
import {Params} from 'react-router'
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
  let currentUid = accountUid
  for (let i = 0; i <= maxAccountRedirects; i++) {
    if (visited.has(currentUid)) {
      throw new Error(`Account redirect cycle detected for ID: ${currentUid}`)
    }
    visited.add(currentUid)

    grpcAccount = await grpcClient.documents.getAccount({
      id: currentUid,
    })

    // If there's no alias, we've reached the final account.
    if (!grpcAccount.aliasAccount) {
      break
    }

    currentUid = grpcAccount.aliasAccount
  }

  if (!grpcAccount) {
    throw new Error(
      `Account redirect chain is too long (${maxAccountRedirects})`,
    )
  }

  const serverAccount = toPlainMessage(grpcAccount)
  if (serverAccount.aliasAccount) {
    return await getAccount(serverAccount.aliasAccount)
  }
  const serverMetadata = grpcAccount.metadata?.toJson() || {}
  const metadata = HMDocumentMetadataSchema.parse(serverMetadata)
  return {
    id: hmId(grpcAccount.id),
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
