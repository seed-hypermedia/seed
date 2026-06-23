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

type AccountsByUid = HMListDocumentCollaboratorsRequest['output']['accounts']

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

function getCanonicalAccountUid(accounts: AccountsByUid, uid: string) {
  return accounts[uid]?.id.uid || uid
}

function addCanonicalAccountEntries(accounts: AccountsByUid) {
  const out = {...accounts}
  Object.values(accounts).forEach((account) => {
    out[account.id.uid] = out[account.id.uid] || account
  })
  return out
}

function canonicalizeCapability(capability: HMCapability, accounts: AccountsByUid): HMCapability {
  return {
    ...capability,
    accountUid: getCanonicalAccountUid(accounts, capability.accountUid),
  }
}

/** Deduplicates site member rows by canonical/root account, keeping writer rows over member rows. */
export function dedupeSiteMembersByCanonicalAccount({
  accounts,
  capabilities,
  members,
}: {
  accounts: AccountsByUid
  capabilities: HMCapability[]
  members: HMSiteMember[]
}) {
  const seenMembers = new Set<string>()
  const grantedMembers: HMSiteMember[] = []
  const dedupedMembers: HMSiteMember[] = []

  capabilities.forEach((capability) => {
    const accountUid = getCanonicalAccountUid(accounts, capability.accountUid)
    if (seenMembers.has(accountUid)) return
    seenMembers.add(accountUid)
    grantedMembers.push({
      account: hmId(accountUid),
      role: capability.role === 'writer' ? 'writer' : 'member',
    })
  })

  members.forEach((member) => {
    const accountUid = getCanonicalAccountUid(accounts, member.account.uid)
    if (seenMembers.has(accountUid)) return
    seenMembers.add(accountUid)
    dedupedMembers.push({
      account: hmId(accountUid),
      role: 'member',
    })
  })

  return {
    grantedMembers,
    members: dedupedMembers,
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

      const contactMembers: HMSiteMember[] = []

      contactsResult?.contacts.forEach((contact) => {
        const plain = toPlainMessage(contact)
        const metadata = contact.metadata?.toJson() as Record<string, unknown> | undefined
        const subscribe = metadata?.subscribe as {site?: boolean} | undefined
        if (!subscribe?.site) return
        contactMembers.push({
          account: hmId(plain.account),
          role: 'member',
        })
      })

      const rawAccountUids = new Set<string>([input.targetId.uid])
      capabilities.forEach((capability) => rawAccountUids.add(capability.accountUid))
      contactMembers.forEach((member) => rawAccountUids.add(member.account.uid))

      const accounts = addCanonicalAccountEntries(await loadAccounts(grpcClient, Array.from(rawAccountUids)))

      const canonicalCapabilities = capabilities.map((capability) => canonicalizeCapability(capability, accounts))

      const seenCapabilities = new Set<string>()
      const dedupeCapabilities = (list: HMCapability[]) =>
        list.filter((capability) => {
          if (seenCapabilities.has(capability.accountUid)) return false
          seenCapabilities.add(capability.accountUid)
          return true
        })

      const parentCapabilities = dedupeCapabilities(
        canonicalCapabilities.filter((capability) => capability.grantId.id !== input.targetId.id),
      )
      const grantedCapabilities = dedupeCapabilities(
        canonicalCapabilities.filter((capability) => capability.grantId.id === input.targetId.id),
      )

      const {grantedMembers, members} = dedupeSiteMembersByCanonicalAccount({
        accounts,
        capabilities: canonicalCapabilities,
        members: contactMembers,
      })

      const accountUids = new Set<string>([input.targetId.uid])
      parentCapabilities.forEach((capability) => accountUids.add(capability.accountUid))
      grantedCapabilities.forEach((capability) => accountUids.add(capability.accountUid))
      grantedMembers.forEach((member) => accountUids.add(member.account.uid))
      members.forEach((member) => accountUids.add(member.account.uid))
      accountUids.forEach((uid) => {
        if (!accounts[uid]) accounts[uid] = {id: hmId(uid), metadata: null}
      })

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
