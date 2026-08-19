import {type AgentDefinition, type AgentModelRef} from './client'
import {
  describeAgentServer,
  useLocalAgentServerUrl,
  useModelProviders,
  useProviderModelCatalogs,
  useUpdateAgent,
} from './models'
import {modelLabel} from './model-utils'
import {useSelectedAccountId} from './account'
import {useNavigate} from './navigation'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {toast} from '@shm/ui/toast'
import type {NavRoute} from '@shm/shared/routes'
import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {Button} from '@shm/ui/button'
import {Badge} from '@shm/ui/components/badge'
import {OptionsDropdown, type MenuItemType} from '@shm/ui/options-dropdown'
import {PageTab} from '@shm/ui/page-tabs'
import {coerceReasoningLevel, ReasoningBadge, ReasoningSlider} from './reasoning-select'
import {modelReasoningSupport, type ReasoningLevel} from '@seed-hypermedia/agents-protocol'
import {SizableText} from '@shm/ui/text'
import {
  ArrowLeft,
  Brain,
  Check,
  ChevronsUpDown,
  GitBranch,
  MessageSquarePlus,
  MessagesSquare,
  Pencil,
  ScrollText,
  Settings,
  Users,
  Wrench,
} from 'lucide-react'
import {Fragment, type ReactNode, useEffect, useMemo, useRef, useState} from 'react'

export type AgentPageTab = 'sessions' | 'triggers' | 'memory' | 'tools' | 'prompt' | 'collaborators' | 'settings'

export type AgentHeaderInfo = {
  definition: AgentDefinition
  status: string
  /** Viewer's role on the agent; model switching from the header needs write access. */
  accessRole?: string
}

type AgentBreadcrumbItem = {label: string; route?: NavRoute}

type AgentTitleSaveState = 'idle' | 'saving' | 'saved' | 'error'

export function AgentBreadcrumb({
  serverUrl,
  agentId,
  agentName,
  items = [],
}: {
  serverUrl?: string
  agentId?: string
  agentName?: string
  items?: AgentBreadcrumbItem[]
}) {
  const navigate = useNavigate()
  const localServerUrl = useLocalAgentServerUrl()
  // The desktop-managed server is a named place, not an address: its port moves between launches,
  // so "localhost:3050" in a breadcrumb is noise at best and wrong at worst.
  const serverLabel = serverUrl ? describeAgentServer(serverUrl, localServerUrl.data) : null
  const serverIsCurrent = !!serverUrl && !agentName && !items.length
  return (
    <nav className="text-muted-foreground flex items-center gap-1 text-xs" aria-label="Agent breadcrumb">
      <button
        className="hover:text-foreground rounded px-1 py-0.5 max-sm:inline-flex max-sm:min-h-10 max-sm:items-center"
        onClick={() => navigate({key: 'agents'})}
      >
        Agents
      </button>
      {serverUrl ? (
        <>
          <span>&gt;</span>
          {serverIsCurrent ? (
            <span className="text-foreground max-w-48 truncate rounded px-1 py-0.5">{serverLabel}</span>
          ) : (
            <button
              className="hover:text-foreground max-w-48 truncate rounded px-1 py-0.5 max-sm:inline-flex max-sm:min-h-10 max-sm:items-center"
              onClick={() => navigate({key: 'agent-server', serverUrl})}
            >
              {serverLabel}
            </button>
          )}
        </>
      ) : null}
      {serverUrl && agentName ? (
        <>
          <span>&gt;</span>
          <button
            className="hover:text-foreground max-w-48 truncate rounded px-1 py-0.5 max-sm:inline-flex max-sm:min-h-10 max-sm:items-center"
            onClick={() => agentId && navigate({key: 'agent', agentId, serverUrl})}
            disabled={!agentId}
          >
            {agentName}
          </button>
        </>
      ) : null}
      {items.map((item, index) => (
        <Fragment key={`${item.label}:${index}`}>
          <span>&gt;</span>
          {item.route ? (
            <button
              className="hover:text-foreground max-w-48 truncate rounded px-1 py-0.5 max-sm:inline-flex max-sm:min-h-10 max-sm:items-center"
              onClick={() => navigate(item.route!)}
            >
              {item.label}
            </button>
          ) : (
            <span className="text-foreground max-w-48 truncate rounded px-1 py-0.5">{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}

export function AgentSubpageHeader({
  title,
  placeholder,
  onTitleChange,
  saveState = 'idle',
  disabled,
  backLabel,
  onBack,
  actions,
  children,
}: {
  title: string
  placeholder: string
  onTitleChange: (title: string) => void
  saveState?: AgentTitleSaveState
  disabled?: boolean
  backLabel: string
  onBack: () => void
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="bg-card relative z-10 w-full flex-none shadow-sm">
      <div className="mx-auto flex h-12 w-full max-w-4xl items-center gap-2 px-4">
        <Button variant="ghost" size="icon" aria-label={backLabel} onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            aria-label={placeholder}
            value={title}
            placeholder={placeholder}
            onChange={(event) => onTitleChange(event.currentTarget.value)}
            className="focus:ring-primary/25 min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-lg font-bold outline-none focus:ring-2"
            disabled={disabled}
          />
          {saveState !== 'idle' ? (
            <span
              aria-label={
                saveState === 'saving' ? 'Saving title' : saveState === 'saved' ? 'Title saved' : 'Title save failed'
              }
              className={`size-2 flex-none rounded-full ${
                saveState === 'saving'
                  ? 'bg-muted-foreground/50'
                  : saveState === 'saved'
                    ? 'bg-green-500'
                    : 'bg-destructive'
              }`}
            />
          ) : null}
        </div>
        {actions}
        {children}
      </div>
    </header>
  )
}

export function AgentHeader({
  agent,
  agentId,
  agentName,
  agentNameSaveState = 'idle',
  onAgentNameChange,
  onEditName,
  serverUrl,
  activeTab,
  sessionsCount,
  triggersCount,
  onCreateSession,
  creatingSession,
  onCreateTrigger,
  canCreateTrigger,
  menuItems,
  breadcrumbItems,
}: {
  agent?: AgentHeaderInfo
  agentId?: string
  agentName?: string
  agentNameSaveState?: AgentTitleSaveState
  onAgentNameChange?: (value: string) => void
  onEditName?: () => void
  serverUrl: string
  activeTab: AgentPageTab
  sessionsCount?: number
  triggersCount?: number
  onCreateSession?: () => void
  creatingSession?: boolean
  onCreateTrigger?: () => void
  canCreateTrigger?: boolean
  /** Rows for the top-right options menu; the menu renders only when at least one row is present. */
  menuItems?: (MenuItemType | null)[]
  breadcrumbItems?: AgentBreadcrumbItem[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [showLabels, setShowLabels] = useState(true)
  const tabs = [
    {
      key: 'sessions' as const,
      label: 'Sessions',
      tooltip: 'Open agent sessions',
      icon: MessagesSquare,
      count: sessionsCount || undefined,
    },
    {
      key: 'triggers' as const,
      label: 'Triggers',
      tooltip: 'Create sessions from Seed activity',
      icon: GitBranch,
      count: triggersCount || undefined,
    },
    {key: 'memory' as const, label: 'Memory', tooltip: "Browse and edit the agent's memory files", icon: Brain},
    {key: 'tools' as const, label: 'Tools', tooltip: 'Control tools and signing identities', icon: Wrench},
    {key: 'prompt' as const, label: 'Prompt', tooltip: 'Edit the system prompt', icon: ScrollText},
    {key: 'collaborators' as const, label: 'Collaborators', tooltip: 'Manage who can access this agent', icon: Users},
    {key: 'settings' as const, label: 'Settings', tooltip: 'Edit model settings', icon: Settings},
  ]

  const activeTabLabel = tabs.find((tab) => tab.key === activeTab)?.label || 'Sessions'
  const currentAgentName = agentName ?? agent?.definition.name ?? 'Agent'

  useIsomorphicLayoutEffect(() => {
    if (!containerRef.current || !measureRef.current) return

    const updateLabelVisibility = () => {
      if (!containerRef.current || !measureRef.current) return

      setShowLabels(measureRef.current.offsetWidth + 20 <= containerRef.current.offsetWidth)
    }

    updateLabelVisibility()

    const resizeObserver = new ResizeObserver(updateLabelVisibility)
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [activeTab, agentId, serverUrl, sessionsCount, triggersCount])

  return (
    <>
      <AgentBreadcrumb
        serverUrl={serverUrl}
        agentId={agentId}
        agentName={currentAgentName}
        items={breadcrumbItems || [{label: activeTabLabel}]}
      />
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 sm:flex-nowrap">
          <div className="flex min-w-0 flex-col gap-1">
            {onEditName ? (
              <button
                type="button"
                aria-label="Rename agent"
                onClick={onEditName}
                className="hover:bg-muted/60 group -mx-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left"
              >
                <SizableText size="2xl" weight="bold" className="min-w-0 truncate">
                  {currentAgentName}
                </SizableText>
                <Pencil className="text-muted-foreground size-4 flex-none opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            ) : onAgentNameChange ? (
              <input
                aria-label="Agent name"
                className="focus:ring-primary/25 -mx-1 min-w-0 truncate rounded-md bg-transparent px-1 py-0.5 text-2xl font-bold outline-none focus:ring-2"
                value={agentName ?? agent?.definition.name ?? ''}
                placeholder="Agent"
                onChange={(event) => onAgentNameChange(event.currentTarget.value)}
              />
            ) : (
              <SizableText size="2xl" weight="bold" className="block truncate">
                {agent?.definition.name || 'Agent'}
              </SizableText>
            )}
            {!agent ? (
              <SizableText color="muted" className="block">
                Loading agent…
              </SizableText>
            ) : agentNameSaveState === 'saving' ? (
              <SizableText color="muted" className="block">
                Saving…
              </SizableText>
            ) : agentNameSaveState === 'saved' ? (
              <SizableText color="muted" className="block">
                Saved
              </SizableText>
            ) : agentNameSaveState === 'error' ? (
              <SizableText color="muted" className="block">
                Save failed
              </SizableText>
            ) : null}
          </div>
          <div className="flex flex-none items-center gap-2">
            {agent ? <AgentModelBadge agent={agent} agentId={agentId} serverUrl={serverUrl} /> : null}
            {agent ? <ReasoningBadge level={agent.definition.reasoningLevel} /> : null}
            {activeTab === 'sessions' && onCreateSession ? (
              <Button className="max-sm:min-h-10" onClick={onCreateSession} disabled={creatingSession}>
                <MessageSquarePlus className="mr-2 size-4" /> New session
              </Button>
            ) : null}
            {activeTab === 'triggers' && onCreateTrigger ? (
              <Button className="max-sm:min-h-10" onClick={onCreateTrigger} disabled={!canCreateTrigger}>
                <GitBranch className="mr-2 size-4" /> New trigger
              </Button>
            ) : null}
            {menuItems?.some((item) => item != null) ? (
              <OptionsDropdown menuItems={menuItems} align="end" ariaLabel="Agent options" />
            ) : null}
          </div>
        </div>

        {agentId ? (
          <div
            ref={containerRef}
            className="bg-panel/95 sticky top-0 z-10 -mx-1 flex items-center gap-2 p-1 backdrop-blur md:gap-4"
          >
            <div
              ref={measureRef}
              className="pointer-events-none absolute flex items-center gap-2 opacity-0 md:gap-4"
              aria-hidden="true"
            >
              {tabs.map((tab) => (
                <PageTab
                  key={tab.key}
                  active={activeTab === tab.key}
                  route={{
                    key: 'agent',
                    agentId,
                    serverUrl,
                    tab: tab.key === 'sessions' ? undefined : tab.key,
                  }}
                  label={tab.label}
                  tooltip={tab.tooltip}
                  icon={tab.icon}
                  count={tab.count}
                  showLabel
                  className="flex-none"
                />
              ))}
            </div>
            {tabs.map((tab) => (
              <PageTab
                key={tab.key}
                active={activeTab === tab.key}
                route={{
                  key: 'agent',
                  agentId,
                  serverUrl,
                  tab: tab.key === 'sessions' ? undefined : tab.key,
                }}
                label={tab.label}
                tooltip={tab.tooltip}
                icon={tab.icon}
                count={tab.count}
                showLabel={showLabels}
                className="flex-none max-sm:min-h-10"
              />
            ))}
          </div>
        ) : null}
      </section>
    </>
  )
}

/**
 * The header's current-model tag. For writers it opens a dropdown of the
 * models checked in the agent's settings — which may span multiple providers —
 * and switches the agent's active provider/model pair in place; read-only
 * viewers and single-model agents get the plain badge.
 */
function AgentModelBadge({agent, agentId, serverUrl}: {agent: AgentHeaderInfo; agentId?: string; serverUrl: string}) {
  const accountUid = useSelectedAccountId()
  const updateAgent = useUpdateAgent(serverUrl, accountUid)
  const definition = agent.definition
  const canWrite = !agent.accessRole || agent.accessRole === 'owner' || agent.accessRole === 'writer'
  const providers = useModelProviders(serverUrl, accountUid, canWrite ? agentId : undefined)
  const catalogProviders = useMemo(
    () =>
      Array.from(
        new Set([definition.modelProvider, ...(definition.enabledModels ?? []).map((entry) => entry.provider)]),
      ),
    [definition.modelProvider, definition.enabledModels],
  )
  const catalogs = useProviderModelCatalogs(serverUrl, accountUid, canWrite && agentId ? catalogProviders : [], agentId)
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  // The switchable set: the active pair plus every checked entry whose provider still
  // exists AND whose provider's live catalog actually lists the model — a model a
  // provider does not serve must never be offered under it. An unloaded provider list
  // or catalog filters nothing, so a transient fetch problem never hides choices.
  const providerNames = providers.data ? new Set(providers.data.map((provider) => provider.name)) : undefined
  const options: AgentModelRef[] = [
    {provider: definition.modelProvider, model: definition.model},
    ...(definition.enabledModels ?? []).filter((entry) => {
      if (entry.provider === definition.modelProvider && entry.model === definition.model) return false
      if (providerNames && !providerNames.has(entry.provider)) return false
      const catalog = catalogs[entry.provider]
      if (catalog?.length) return catalog.some((model) => model.id === entry.model)
      return true
    }),
  ]
  const spansProviders = options.some((entry) => entry.provider !== definition.modelProvider)

  // Reasoning slider state: slider drags fire per step, so the level is held
  // locally and committed after a short pause instead of one request per step.
  const activeProviderType = providers.data?.find((provider) => provider.name === definition.modelProvider)?.type
  const reasoningSupported = activeProviderType ? modelReasoningSupport(activeProviderType, definition.model) : null
  const [pendingLevel, setPendingLevel] = useState<{level: ReasoningLevel | undefined} | null>(null)
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (commitTimer.current) clearTimeout(commitTimer.current)
    },
    [],
  )

  if (!canWrite || !agentId) {
    return (
      <Badge variant="secondary" className="flex-none">
        {definition.model}
      </Badge>
    )
  }

  function handleSelect(entry: AgentModelRef) {
    setOpen(false)
    if (entry.provider === definition.modelProvider && entry.model === definition.model) return
    const providerType = providers.data?.find((provider) => provider.name === entry.provider)?.type
    const nextDefinition = {...definition, modelProvider: entry.provider, model: entry.model}
    const nextLevel = coerceReasoningLevel(providerType, entry.model, definition.reasoningLevel)
    // Avoid an explicit-undefined key: CBOR-encoding it would not equal an absent field.
    if (nextLevel) nextDefinition.reasoningLevel = nextLevel
    else delete nextDefinition.reasoningLevel
    updateAgent.mutate(
      {agentId: agentId!, definition: nextDefinition},
      {onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not switch model')},
    )
  }

  function handleReasoningChange(level: ReasoningLevel | undefined) {
    setPendingLevel({level})
    if (commitTimer.current) clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => {
      const nextDefinition = {...definition}
      // Avoid an explicit-undefined key: CBOR-encoding it would not equal an absent field.
      if (level) nextDefinition.reasoningLevel = level
      else delete nextDefinition.reasoningLevel
      updateAgent.mutate(
        {agentId: agentId!, definition: nextDefinition},
        {
          onSettled: () => setPendingLevel(null),
          onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not change reasoning level'),
        },
      )
    }, 500)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label="Switch model"
        disabled={updateAgent.isLoading}
        className="bg-secondary text-secondary-foreground hover:bg-secondary/80 flex flex-none items-center gap-1 rounded-md border border-transparent px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50"
      >
        <span className="max-w-48 truncate">{definition.model}</span>
        <ChevronsUpDown className="size-3 shrink-0 opacity-70" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1">
        {options.map((entry) => {
          const isActive = entry.provider === definition.modelProvider && entry.model === definition.model
          const info = catalogs[entry.provider]?.find((model) => model.id === entry.model)
          return (
            <button
              key={`${entry.provider}:${entry.model}`}
              type="button"
              className="hover:bg-muted flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
              onClick={() => handleSelect(entry)}
            >
              <span className="min-w-0 flex-1 truncate">{info ? modelLabel(info) : entry.model}</span>
              {spansProviders ? <span className="text-muted-foreground shrink-0 text-xs">{entry.provider}</span> : null}
              {isActive ? <Check className="size-4 shrink-0" /> : null}
            </button>
          )
        })}
        {reasoningSupported ? (
          <div className="border-border mt-1 border-t px-2 pt-2 pb-1">
            <ReasoningSlider
              providerType={activeProviderType}
              model={definition.model}
              value={pendingLevel ? pendingLevel.level : definition.reasoningLevel}
              onChange={handleReasoningChange}
            />
          </div>
        ) : null}
        <div className="border-border mt-1 border-t pt-1">
          {options.length <= 1 ? (
            <SizableText size="xs" color="muted" className="block px-2 pt-1 pb-0.5">
              Check more models in Settings to switch between them here.
            </SizableText>
          ) : null}
          <button
            type="button"
            className="hover:bg-muted text-muted-foreground w-full rounded-sm px-2 py-1.5 text-left text-xs"
            onClick={() => {
              setOpen(false)
              navigate({key: 'agent', agentId: agentId!, serverUrl, tab: 'settings'})
            }}
          >
            Choose models in Settings…
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
