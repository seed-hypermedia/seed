import {
  describeAgentServer,
  prefetchAgentDetail,
  useAgentServerHealth,
  useAgentServerUrls,
  useLocalAgentServerUrl,
  useModelProviders,
  useMoveAgent,
} from './models'
import {MoveAgentSourceDeleteError} from './move-agent'
import {Button} from '@shm/ui/button'
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {SelectDropdown} from '@shm/ui/select-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {ArrowRightLeft, Plus} from 'lucide-react'
import {useEffect, useState} from 'react'
import {AddModelProviderDialog} from './dialogs'
import {ProviderSelect} from './provider-select'

/**
 * Moves an agent to another configured agent server. The dialog picks the destination, preflights
 * what the destination can honor (reachability, a model provider for the agent), spells out what
 * moves and what stays, and then runs the copy-then-delete orchestration with live progress.
 */
export function MoveAgentDialog({
  input,
  onClose,
}: {
  input: {
    sourceServerUrl: string
    selectedAccountId: string | null | undefined
    agentId: string
    agentName: string
    /** Provider name the agent currently references, used to preflight the destination. */
    modelProvider: string
    /** Top-level session count, so the warning about deleted history is concrete. */
    sessionsCount: number
    onMoved: (moved: {serverUrl: string; agentId: string}) => void
  }
  onClose: () => void
}) {
  const serverUrls = useAgentServerUrls()
  const localServerUrl = useLocalAgentServerUrl()
  const targetUrls = (serverUrls.data || []).filter((url) => url !== input.sourceServerUrl)
  const [targetServerUrl, setTargetServerUrl] = useState('')
  const targetHealth = useAgentServerHealth(targetServerUrl || undefined)
  const targetProviders = useModelProviders(targetServerUrl || undefined, input.selectedAccountId)
  const [providerOverride, setProviderOverride] = useState('')
  const addProviderDialog = useAppDialog(AddModelProviderDialog)
  const moveAgent = useMoveAgent(input.selectedAccountId)
  const [progress, setProgress] = useState<string | null>(null)

  useEffect(() => {
    if (!targetServerUrl && targetUrls.length) setTargetServerUrl(targetUrls[0]!)
  }, [targetServerUrl, targetUrls])

  // A provider choice belongs to one server; a stale override must not follow a server switch.
  useEffect(() => {
    setProviderOverride('')
  }, [targetServerUrl])

  const providerMatches = targetProviders.data?.some((provider) => provider.name === input.modelProvider) ?? false
  const effectiveProvider = providerMatches ? input.modelProvider : providerOverride
  const targetProviderType = targetProviders.data?.find((provider) => provider.name === effectiveProvider)?.type
  const targetUnreachable = !!targetServerUrl && targetHealth.isError
  const moving = moveAgent.isLoading

  async function handleMove() {
    if (!targetServerUrl) {
      toast.error('Choose a destination server')
      return
    }
    if (!effectiveProvider) {
      toast.error('Choose a model provider on the destination server')
      return
    }
    try {
      const result = await moveAgent.mutateAsync({
        agentId: input.agentId,
        sourceServerUrl: input.sourceServerUrl,
        targetServerUrl,
        targetModelProvider: effectiveProvider,
        targetProviderType,
        onProgress: (update) => setProgress(update.label),
      })
      await prefetchAgentDetail(targetServerUrl, input.selectedAccountId, result.newAgentId).catch(() => {})
      toast.success('Agent moved')
      onClose()
      input.onMoved({serverUrl: targetServerUrl, agentId: result.newAgentId})
    } catch (error) {
      if (error instanceof MoveAgentSourceDeleteError) {
        // The copy landed; only the source cleanup failed. Follow the agent to its new home and
        // tell the user the original is still on the old server.
        toast.error(error.message)
        onClose()
        input.onMoved({serverUrl: targetServerUrl, agentId: error.newAgentId})
        return
      }
      setProgress(null)
      toast.error(error instanceof Error ? error.message : 'Could not move agent')
    }
  }

  if (serverUrls.data && !targetUrls.length) {
    return (
      <div className="flex min-w-[420px] flex-col gap-4">
        <DialogTitle>Move “{input.agentName}”</DialogTitle>
        <DialogDescription>
          This is the only agent server configured. Add another server from the Agents page, then move the agent there.
        </DialogDescription>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-[460px] flex-col gap-5">
      <div className="flex flex-col gap-3">
        <DialogTitle>Move “{input.agentName}” to another server</DialogTitle>
        <DialogDescription>
          The agent’s settings, system prompt, memory files, authored tools, and triggers move with it. Sessions and run
          history cannot move and are deleted with the original
          {input.sessionsCount ? ` (${input.sessionsCount} session${input.sessionsCount === 1 ? '' : 's'})` : ''}. Its
          publishing accounts and collaborators stay on the current server.
        </DialogDescription>
      </div>

      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Destination server
        </SizableText>
        <SelectDropdown
          options={targetUrls.map((url) => ({value: url, label: describeAgentServer(url, localServerUrl.data)}))}
          value={targetServerUrl}
          onValue={setTargetServerUrl}
          placeholder="Select a server"
          disabled={moving}
        />
        {targetUnreachable ? (
          <SizableText size="xs" className="text-destructive">
            Can’t reach this server right now.
          </SizableText>
        ) : null}
      </label>

      {targetServerUrl && !targetUnreachable && targetProviders.data && !providerMatches ? (
        <div className="flex flex-col gap-1">
          <SizableText size="sm" weight="bold">
            Model provider
          </SizableText>
          <SizableText size="xs" color="muted">
            The destination server has no provider named “{input.modelProvider}”. Choose one for the agent to use there.
          </SizableText>
          {targetProviders.data.length ? (
            <ProviderSelect
              providers={targetProviders.data}
              value={providerOverride}
              onChange={setProviderOverride}
              onAddProvider={() =>
                addProviderDialog.open({
                  serverUrl: targetServerUrl,
                  selectedAccountId: input.selectedAccountId,
                  onSaved: setProviderOverride,
                })
              }
              disabled={moving}
            />
          ) : (
            <Button
              variant="outline"
              className="w-fit"
              disabled={moving}
              onClick={() =>
                addProviderDialog.open({
                  serverUrl: targetServerUrl,
                  selectedAccountId: input.selectedAccountId,
                  onSaved: setProviderOverride,
                })
              }
            >
              <Plus className="size-4" />
              Add a provider on this server
            </Button>
          )}
        </div>
      ) : null}

      {moving && progress ? (
        <div className="flex items-center gap-2">
          <Spinner />
          <SizableText size="sm" color="muted">
            {progress}…
          </SizableText>
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={moving}>
          Cancel
        </Button>
        <Button
          onClick={() => void handleMove()}
          disabled={moving || !targetServerUrl || targetUnreachable || !effectiveProvider}
        >
          <ArrowRightLeft className="size-4" />
          Move agent
        </Button>
      </div>
      {addProviderDialog.content}
    </div>
  )
}
