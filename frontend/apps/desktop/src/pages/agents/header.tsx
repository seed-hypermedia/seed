import {type AgentDefinition} from '@/agents-client'
import {useNavigate} from '@/utils/useNavigate'
import type {NavRoute} from '@shm/shared/routes'
import {hostnameStripProtocol} from '@shm/shared'
import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {Button} from '@shm/ui/button'
import {PageTab} from '@shm/ui/page-tabs'
import {SizableText} from '@shm/ui/text'
import {
  ArrowLeft,
  GitBranch,
  MessageSquarePlus,
  MessagesSquare,
  Pencil,
  ScrollText,
  Settings,
  Wrench,
} from 'lucide-react'
import {Fragment, type ReactNode, useRef, useState} from 'react'

export type AgentPageTab = 'sessions' | 'triggers' | 'tools' | 'prompt' | 'settings'

export type AgentHeaderInfo = {
  definition: AgentDefinition
  status: string
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
  const serverIsCurrent = !!serverUrl && !agentName && !items.length
  return (
    <nav className="text-muted-foreground flex items-center gap-1 text-xs" aria-label="Agent breadcrumb">
      <button className="hover:text-foreground rounded px-1 py-0.5" onClick={() => navigate({key: 'agents'})}>
        Agents
      </button>
      {serverUrl ? (
        <>
          <span>&gt;</span>
          {serverIsCurrent ? (
            <span className="text-foreground max-w-48 truncate rounded px-1 py-0.5">
              {hostnameStripProtocol(serverUrl)}
            </span>
          ) : (
            <button
              className="hover:text-foreground max-w-48 truncate rounded px-1 py-0.5"
              onClick={() => navigate({key: 'agent-server', serverUrl})}
            >
              {hostnameStripProtocol(serverUrl)}
            </button>
          )}
        </>
      ) : null}
      {serverUrl && agentName ? (
        <>
          <span>&gt;</span>
          <button
            className="hover:text-foreground max-w-48 truncate rounded px-1 py-0.5"
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
              className="hover:text-foreground max-w-48 truncate rounded px-1 py-0.5"
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
  breadcrumbItems?: AgentBreadcrumbItem[]
}) {
  const navigate = useNavigate()
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
    {key: 'tools' as const, label: 'Tools', tooltip: 'Control tools and signing identities', icon: Wrench},
    {key: 'prompt' as const, label: 'Prompt', tooltip: 'Edit the system prompt', icon: ScrollText},
    {key: 'settings' as const, label: 'Settings', tooltip: 'Edit agent settings', icon: Settings},
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
        <div className="flex items-start justify-between gap-4">
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
            <SizableText color="muted" className="block">
              {agent
                ? `${agent.definition.modelProvider} · ${agent.definition.model} · ${agent.status}`
                : 'Loading agent…'}
              {agentNameSaveState === 'saving'
                ? ' · Saving…'
                : agentNameSaveState === 'saved'
                  ? ' · Saved'
                  : agentNameSaveState === 'error'
                    ? ' · Save failed'
                    : ''}
            </SizableText>
          </div>
          {activeTab === 'sessions' && onCreateSession ? (
            <Button onClick={onCreateSession} disabled={creatingSession}>
              <MessageSquarePlus className="mr-2 size-4" /> New session
            </Button>
          ) : null}
          {activeTab === 'triggers' && onCreateTrigger ? (
            <Button onClick={onCreateTrigger} disabled={!canCreateTrigger}>
              <GitBranch className="mr-2 size-4" /> New trigger
            </Button>
          ) : null}
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
                className="flex-none"
              />
            ))}
          </div>
        ) : null}
      </section>
    </>
  )
}
