import {createPromiseClient, type PromiseClient} from '@connectrpc/connect'
import {createGrpcWebTransport} from '@connectrpc/connect-web'
import {Documents} from '@shm/shared/client/.generated/documents/v3alpha/documents_connect'

export function createDocumentsClient(baseUrl: string): PromiseClient<typeof Documents> {
  const transport = createGrpcWebTransport({
    baseUrl,
  })

  return createPromiseClient(Documents, transport)
}
