import {HMRequestImplementation, HMRequestParams} from './api-types'
import {loadAccounts} from './api-account'
import {BIG_INT} from './constants'
import {GRPCClient} from './grpc-client'
import {
  HMCapability,
  HMListDocumentCollaboratorsRequest,
  HMSiteMember,
  unpackedHmIdSchema,
} from '@seed-hypermedia/client/hm-types'
import {hmId, packHmId, unpackHmId} from './utils'
import {hmIdPathToEntityQueryPath, entityQueryPathToHmIdPath} from './utils/path-api'
import {getErrorMessage, HMRedirectError} from './models/entity'
import {toPlainMessage} from '@bufbuild/protobuf'

function rawRoleToHMRole(role?: string): HMCapability['role'] {
  if (role === 'WRITER') return 'writer'
  if (role === 'AGENT') return 'agent'
  return 'none'
}

function parseTimestamp(ts?: string): HMCapability['createTime'] {
  if (!ts) return {seconds: 0, nanos: 0}
  const ms = new Date(ts).getTime()
  return {seconds: Math.floor(ms / 1000), nanos: (ms % 1000) * 1_000_000}
}

function rawCapabilityToHMCapability(raw: any): HMCapability | null {
  if (!raw.delegate || !raw.account) return null
  return {
    id: raw.id || '',
    accountUid: raw.delegate,
    role: rawRoleToHMRole(raw.role),
    grantId: hmId(raw.account, {
      path: entityQueryPathToHmIdPath(raw.path),
    }),
    label: raw.label,
    createTime: parseTimestamp(raw.createTime),
  }
}

export const ListDocumentCollaborators: HMRequestImplementation<HMListDocumentCollaboratorsRequest> = {
  async getData(grpcClient: GRPCClient, input): Promise<HMListDocumentCollaboratorsRequest['output']> {
    try {
      const [capabilitiesResult, contactsResult] = await Promise.all([
        grpcClient.accessControl.listCapabilities({
          account: input.targetId.uid,
          path: hmIdPathToEntityQueryPath(input.targetId.path),
          pageSize: BIG_INT,
        }),
        input.targetId.path?.length
          ? Promise.resolve(null)
          : grpcClient.documents.listContacts({
              filter: {
                case: 'subject',
                value: input.targetId.uid,
              },
            }),
      ])

      const capabilities = capabilitiesResult.capabilities
        .map((capability) =>
          rawCapabilityToHMCapability(capability.toJson({emitDefaultValues: true, enumAsInteger: false})),
        )
        .filter((capability): capability is HMCapability => capability !== null)
        .filter(
          (capability) => capability.role !== 'agent' && capability.role !== 'owner' && capability.role !== 'none',
        )

      const seenCapabilities = new Set<string>()
      const dedupeCapabilities = (list: HMCapability[]) =>
        list.filter((capability) => {
          if (seenCapabilities.has(capability.accountUid)) return false
          seenCapabilities.add(capability.accountUid)
          return true
        })

      const parentCapabilities = dedupeCapabilities(
        capabilities.filter((capability) => capability.grantId.id !== input.targetId.id),
      )
      const grantedCapabilities = dedupeCapabilities(
        capabilities.filter((capability) => capability.grantId.id === input.targetId.id),
      )

      const seenMembers = new Set<string>()
      const grantedMembers: HMSiteMember[] = []
      const members: HMSiteMember[] = []

      capabilities.forEach((capability) => {
        if (seenMembers.has(capability.accountUid)) return
        seenMembers.add(capability.accountUid)
        grantedMembers.push({
          account: hmId(capability.accountUid),
          role: capability.role === 'writer' ? 'writer' : 'member',
        })
      })

      contactsResult?.contacts.forEach((contact) => {
        const plain = toPlainMessage(contact)
        const metadata = contact.metadata?.toJson() as Record<string, unknown> | undefined
        const subscribe = metadata?.subscribe as {site?: boolean} | undefined
        if (!subscribe?.site) return
        if (seenMembers.has(plain.account)) return
        seenMembers.add(plain.account)
        members.push({
          account: hmId(plain.account),
          role: 'member',
        })
      })

      const accountUids = new Set<string>([input.targetId.uid])
      parentCapabilities.forEach((capability) => accountUids.add(capability.accountUid))
      grantedCapabilities.forEach((capability) => accountUids.add(capability.accountUid))
      grantedMembers.forEach((member) => accountUids.add(member.account.uid))
      members.forEach((member) => accountUids.add(member.account.uid))

      const accounts = await loadAccounts(grpcClient, Array.from(accountUids))

      return {
        publisherUid: input.targetId.uid,
        parentCapabilities,
        grantedCapabilities,
        grantedMembers,
        members,
        accounts,
      }
    } catch (e) {
      const err = getErrorMessage(e)
      if (err instanceof HMRedirectError) {
        return {
          publisherUid: input.targetId.uid,
          parentCapabilities: [],
          grantedCapabilities: [],
          grantedMembers: [],
          members: [],
          accounts: {},
        }
      }
      throw e
    }
  },
}

export const ListDocumentCollaboratorsParams: HMRequestParams<HMListDocumentCollaboratorsRequest> = {
  inputToParams: (input) => ({targetId: packHmId(input.targetId)}),
  paramsToInput: (params) => {
    const targetIdParam = params.targetId
    if (!targetIdParam) {
      throw new Error('Missing targetId query param')
    }
    let targetId = unpackHmId(targetIdParam)
    if (!targetId) {
      try {
        targetId = unpackedHmIdSchema.parse(JSON.parse(targetIdParam))
      } catch {
        throw new Error(`Invalid targetId query param: ${targetIdParam}`)
      }
    }
    return {targetId}
  },
}
