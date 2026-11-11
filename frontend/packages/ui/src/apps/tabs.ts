import {HM_APP_TYPE, HM_TOOL_TYPE} from '@seed-hypermedia/client/apps'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {DocumentPanelRoute, DocumentRoute, NavRoute} from '@shm/shared/routes'
import {FileCode2, House, Settings, Wrench, type LucideIcon} from 'lucide-react'

/** Which typed resource with its own tabs a document is, if any. */
export function appResourceKind(type: unknown): 'app' | 'tool' | null {
  if (type === HM_APP_TYPE) return 'app'
  if (type === HM_TOOL_TYPE) return 'tool'
  return null
}

/** A tab in a typed resource's tab bar. */
export type ResourceTab = {label: string; tooltip: string; icon: LucideIcon; active: boolean; route: NavRoute}

/** The tabs of an app (Home, Tools, Pages, Settings) or a tool (Tool, Settings). */
export function appResourceTabs(
  kind: 'app' | 'tool',
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
  return kind === 'app'
    ? [
        tab('Home', House, undefined),
        tab('Tools', Wrench, 'tools'),
        tab('Pages', FileCode2, 'pages'),
        tab('Settings', Settings, 'settings'),
      ]
    : [tab('Tool', Wrench, undefined), tab('Settings', Settings, 'settings')]
}
