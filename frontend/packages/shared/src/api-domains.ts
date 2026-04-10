import type {
  HMDomainInfo,
  HMGetDomainInput,
  HMGetDomainRequest,
  HMListDomainsInput,
  HMListDomainsOutput,
  HMListDomainsRequest,
} from '@seed-hypermedia/client/hm-types'
import type {HMRequestImplementation} from './api-types'
import type {GRPCClient} from './grpc-client'

function domainInfoFromProto(info: any): HMDomainInfo {
  return {
    domain: info.domain,
    lastCheck: info.lastCheck?.toDate() ?? null,
    status: info.status || 'unknown',
    lastSuccess: info.lastSuccess?.toDate() ?? null,
    registeredAccountUid: info.registeredAccountUid || null,
    peerId: info.peerId || null,
    lastError: info.lastError || null,
  }
}

export const GetDomain: HMRequestImplementation<HMGetDomainRequest> = {
  async getData(grpcClient: GRPCClient, input: HMGetDomainInput): Promise<HMDomainInfo> {
    if (input.forceCheck) {
      const result = await grpcClient.daemon.checkDomain({
        domain: input.domain,
      })
      return domainInfoFromProto(result)
    }
    const result = await grpcClient.daemon.getDomain({domain: input.domain})
    return domainInfoFromProto(result)
  },
}

export const ListDomains: HMRequestImplementation<HMListDomainsRequest> = {
  async getData(grpcClient: GRPCClient, _input: HMListDomainsInput): Promise<HMListDomainsOutput> {
    const result = await grpcClient.daemon.listDomains({})
    return {
      domains: result.domains.map(domainInfoFromProto),
    }
  },
}
