// The attribute-query passthroughs: QueryDocuments, ListDocumentAttributeNames and
// ListDocumentAttributeValues take and return the daemon's protobuf JSON as-is, so the CLI, the
// agents service and the app's Explore surface share one request shape (see the Explore grammar
// compiler in @seed-hypermedia/client/explore-query).
import type {JsonValue} from '@bufbuild/protobuf'
import type {
  HMListDocumentAttributeNamesRequest,
  HMListDocumentAttributeValuesRequest,
  HMQueryDocumentsRequest,
} from '@seed-hypermedia/client/hm-types'
import type {HMRequestImplementation} from './api-types'
import {
  ListDocumentAttributeNamesRequest,
  ListDocumentAttributeValuesRequest,
  QueryDocumentsRequest,
} from './client/grpc-types'

export const QueryDocuments: HMRequestImplementation<HMQueryDocumentsRequest> = {
  async getData(grpcClient, input) {
    const result = await grpcClient.documents.queryDocuments(QueryDocumentsRequest.fromJson(input as JsonValue))
    return result.toJson() as HMQueryDocumentsRequest['output']
  },
}

export const ListDocumentAttributeNames: HMRequestImplementation<HMListDocumentAttributeNamesRequest> = {
  async getData(grpcClient, input) {
    const result = await grpcClient.documents.listDocumentAttributeNames(
      ListDocumentAttributeNamesRequest.fromJson(input as JsonValue),
    )
    return result.toJson() as HMListDocumentAttributeNamesRequest['output']
  },
}

export const ListDocumentAttributeValues: HMRequestImplementation<HMListDocumentAttributeValuesRequest> = {
  async getData(grpcClient, input) {
    const result = await grpcClient.documents.listDocumentAttributeValues(
      ListDocumentAttributeValuesRequest.fromJson(input as JsonValue),
    )
    return result.toJson() as HMListDocumentAttributeValuesRequest['output']
  },
}
