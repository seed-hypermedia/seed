import {HM_APP_TYPE, HM_TOOL_TYPE, HM_TRIGGER_TYPE} from '@seed-hypermedia/client/apps'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {DocumentPanelRoute, DocumentRoute, NavRoute} from '@shm/shared/routes'
import {Bot, Brain, FileCode2, House, Settings, Users, Wrench, Zap, type LucideIcon} from 'lucide-react'

/** Which typed resource with its own tabs a document is, if any. */
export function appResourceKind(type: unknown): 'app' | 'tool' | 'trigger' | null {
  if (type === HM_APP_TYPE) return 'app'
  if (type === HM_TOOL_TYPE) return 'tool'
  if (type === HM_TRIGGER_TYPE) return 'trigger'
  return null
}

/** A tab in a typed resource's tab bar. */
export type ResourceTab = {label: string; tooltip: string; icon: LucideIcon; active: boolean; route: NavRoute}

/**
 * An app's tabs: Home, Tools, Pages, Triggers and Settings. A tool shows its app's tabs with Tools
 * selected, a trigger with Triggers selected.
 */
export function appResourceTabs(
  id: UnpackedHypermediaId,
  appView: DocumentRoute['appView'],
  panel?: DocumentPanelRoute | null,
): ResourceTab[] {
  const base = {...id, version: null, latest: true, blockRef: null, blockRange: null}
  const tab = (label: string, icon: LucideIcon, view: DocumentRoute['appView']): ResourceTab => ({
    label,
    tooltip: `Open ${label}`,
    icon,
    active: appView === view,
    route: {key: 'document', id: base, ...(view ? {appView: view} : {}), ...(panel ? {panel} : {})},
  })
  return [
    tab('Home', House, undefined),
    tab('Tools', Wrench, 'tools'),
    tab('Pages', FileCode2, 'pages'),
    tab('Triggers', Zap, 'triggers'),
    tab('Settings', Settings, 'settings'),
  ]
}

/**
 * An agent's tabs, for a page inside it (one of its tools or triggers): the same tabs its own
 * document shows, so a tool or trigger stays inside its agent the way an app's stay inside the app.
 */
export function agentResourceTabs(
  id: UnpackedHypermediaId,
  active: DocumentRoute['agentView'] | 'home' | null,
): ResourceTab[] {
  const base = {...id, version: null, latest: true, blockRef: null, blockRange: null}
  const tab = (label: string, icon: LucideIcon, view: DocumentRoute['agentView'] | 'home'): ResourceTab => ({
    label,
    tooltip: `Open agent ${label.toLowerCase()}`,
    icon,
    active: active === view,
    route: {key: 'document', id: base, ...(view !== 'home' ? {agentView: view} : {})},
  })
  return [
    tab('Home', House, 'home'),
    tab('Sessions', Bot, 'sessions'),
    tab('Triggers', Zap, 'triggers'),
    tab('Memory', Brain, 'memory'),
    tab('People', Users, 'access'),
    tab('Settings', Settings, 'settings'),
  ]
}
