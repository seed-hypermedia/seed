import {createTombstoneRef, followToDocument, type SeedClient} from '@seed-hypermedia/client'
import type {HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, useUniversalAppContext, useUniversalClient} from '@shm/shared'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {getParentPaths} from '@shm/shared/utils/breadcrumbs'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {Unlink} from 'lucide-react'
import {base58btc} from 'multiformats/bases/base58'
import {useState, type ReactNode} from 'react'
import {Button} from '../button'
import type {MenuItemType} from '../options-dropdown'
import {SizableText} from '../text'
import {toast} from '../toast'
import {useAppDialog} from '../universal-dialog'
import type {AgentInfo} from './client'
import {mountedAgentServerUrl} from './delete-mounted-agent'
import {describeAgentServer, useAgentDetail, useLocalAgentServerUrl, useUnmountAgent} from './models'
import {useNavigate} from './navigation'
import {getAgentsPlatform} from './platform'

/**
 * Developer mode only: "Orphan agent" in a mounted agent document's options menu, the undo of
 * adopting. The server gives the agent its pre-mount id back (or a fresh one) and keeps its
 * sessions, memory and triggers; the mount document is then deleted and the agent's own page
 * opens, where it can be adopted again. Owner-only, like adopting.
 */
export function useOrphanAgentMenu(
  docId: UnpackedHypermediaId,
  metadata: HMMetadata | undefined,
): {item: MenuItemType | null; content: ReactNode} {
  const {experiments} = useUniversalAppContext()
  const serverUrl = mountedAgentServerUrl(metadata)
  const accountUid = getAgentsPlatform().useAccountUid()
  const agentId = hmId(docId.uid, {path: docId.path}).id
  const agent = useAgentDetail(serverUrl, accountUid, agentId)
  const dialog = useAppDialog(OrphanAgentDialog)
  const canOrphan =
    !!experiments?.developerTools &&
    !!serverUrl &&
    !!accountUid &&
    agent.data?.agent.id === agentId &&
    agent.data.agent.accessRole === 'owner'
  return {
    item: canOrphan
      ? {
          key: 'orphan-agent',
          label: 'Orphan agent',
          icon: <Unlink className="size-4" />,
          onClick: () => dialog.open({agent: agent.data!.agent, serverUrl: serverUrl!, accountUid: accountUid!, docId}),
        }
      : null,
    content: dialog.content,
  }
}

function OrphanAgentDialog({
  input,
  onClose,
}: {
  input: {agent: AgentInfo; serverUrl: string; accountUid: string; docId: UnpackedHypermediaId}
  onClose: () => void
}) {
  const client = useUniversalClient()
  const navigate = useNavigate()
  const unmount = useUnmountAgent(input.serverUrl, input.accountUid)
  const localServerUrl = useLocalAgentServerUrl()
  const [busy, setBusy] = useState(false)
  const name = input.agent.definition.name || 'this agent'
  async function orphan() {
    setBusy(true)
    let orphaned = false
    try {
      const response = await unmount.mutateAsync(input.agent.id)
      orphaned = true
      await deleteAgentMountDocument(client, input.accountUid, input.docId)
      toast.success(`Orphaned ${name}`)
      onClose()
      navigate({key: 'agent', agentId: response.agent.id, serverUrl: input.serverUrl})
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(
        orphaned
          ? `${name} is orphaned on its server, but its document could not be deleted: ${message}`
          : `Could not orphan ${name}: ${message}`,
      )
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <SizableText size="lg" weight="bold">
        Orphan {name}?
      </SizableText>
      <SizableText size="sm" color="muted">
        The agent keeps its sessions, memory and triggers on {describeAgentServer(input.serverUrl, localServerUrl.data)}{' '}
        and gets a server id of its own again. This document is deleted. You can adopt the agent into a space again
        later.
      </SizableText>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={() => void orphan()} disabled={busy}>
          Orphan agent
        </Button>
      </div>
    </div>
  )
}

/**
 * Deletes a mount document the way the apps' delete dialogs do (a Tombstone Ref signed by the
 * account, with the account's grant when the document is in another space) and drops it from
 * the caches that list it.
 */
export async function deleteAgentMountDocument(
  client: ReturnType<typeof useUniversalClient>,
  accountUid: string,
  id: UnpackedHypermediaId,
): Promise<void> {
  if (!client.getSigner) throw new Error('Signing is unavailable')
  const signer = client.getSigner(accountUid)
  const signerUid = base58btc.encode(new Uint8Array(await signer.getPublicKey()))
  const resource = await client.request('Resource', id)
  if (resource.type !== 'document' && resource.type !== 'redirect')
    throw new Error(`Cannot delete: resource is ${resource.type}`)
  let genesis: string
  let generation: number
  if (resource.type === 'redirect') {
    const followed = await followToDocument(client as unknown as SeedClient, id)
    genesis = followed.document.genesis
    generation = Date.now()
  } else {
    genesis = resource.document.genesis
    generation = resource.document.generationInfo ? Number(resource.document.generationInfo.generation) : 0
  }
  const capability =
    id.uid === signerUid
      ? undefined
      : (await client.request('ListCapabilities', {targetId: id})).capabilities.find(
          (cap) => cap.delegate === signerUid && (cap.role === 'WRITER' || cap.role === 'AGENT'),
        )?.id
  if (id.uid !== signerUid && !capability) throw new Error('Your signing identity needs write access to this document')
  await client.deleteRecent?.(id.id)
  const refInput = await createTombstoneRef(
    {space: id.uid, path: hmIdPathToEntityQueryPath(id.path), genesis, generation, capability},
    signer,
  )
  await client.publish(refInput)
  invalidateQueries(['agents'])
  invalidateQueries([queryKeys.DOC_LIST_DIRECTORY], {refetchType: 'all'})
  invalidateQueries([queryKeys.DOC_LIST_UNREFERENCED, id.uid], {refetchType: 'all'})
  invalidateQueries([queryKeys.ENTITY, id.id])
  invalidateQueries([queryKeys.RESOLVED_ENTITY, id.id])
  getParentPaths(id.path).forEach((path) => {
    const parentId = hmId(id.uid, {path})
    invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id, 'Children'])
    invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id, 'AllDescendants'])
  })
}
