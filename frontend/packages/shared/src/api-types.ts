import {GRPCClient} from '.'
import {HMMetadataPayload, HMRequest, UnpackedHypermediaId} from './hm-types'

export type ListAPIResponse = {
  documents: HMMetadataPayload[]
  invalidDocuments: {
    id: UnpackedHypermediaId
    error: any
    metadata: any
  }[]
}

export type HMRequestParams<Request extends HMRequest> = {
  inputToParams: (input: Request['input']) => Record<string, string>
  paramsToInput: (params: Record<string, string>) => Request['input']
}

export type QueryDaemonFn = <T>(pathAndQuery: string) => Promise<T>

export type HMRequestImplementation<Request extends HMRequest> = {
  getData: (
    grpcClient: GRPCClient,
    input: Request['input'],
    queryDaemon: QueryDaemonFn,
  ) => Promise<Request['output']>
}
