import {queryClient} from '@/client'
import {parseRequest} from '@/request'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {toPlainMessage} from '@bufbuild/protobuf'
import {Params} from '@remix-run/react'
import {HMDocumentMetadataSchema, hmId, HMMetadataPayload} from '@shm/shared'

async function getAccount(accountUid: string) {
  const grpcAccount = await queryClient.documents.getAccount({
    id: accountUid,
  })

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
  const account = await getAccount(accountUid)
  return wrapJSON(account)
}
