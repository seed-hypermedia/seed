import {parseHMQueryViewJSON, type HMQueryView} from '@seed-hypermedia/client/hm-types'
import {useMemo, useState} from 'react'

/** Writers edit the document draft; readers only override the published View in memory. */
export function useQueryViewFilters({
  scope,
  view,
  canEdit,
  onChange,
}: {
  scope: string
  view: string | undefined
  canEdit: boolean
  onChange: (view: string) => void
}) {
  const saved = useMemo(() => parseHMQueryViewJSON(view)?.filters ?? [], [view])
  const [temporary, setTemporary] = useState<{
    scope: string
    view: string | undefined
    filters: HMQueryView['filters']
  } | null>(null)
  const filters = !canEdit && temporary?.scope === scope && temporary.view === view ? temporary.filters : saved
  const setFilters = (filters: HMQueryView['filters']) => {
    if (canEdit) {
      // Normal Publish is still required: filtering never signs or publishes implicitly.
      onChange(JSON.stringify({filters}))
    } else {
      setTemporary({scope, view, filters})
    }
  }
  return [filters, setFilters] as const
}
