import {createContext, useContext} from 'react'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {NavRoute} from '@shm/shared/routes'

export type QuerySearchInputProps = {
  onClose?: () => void
  allowWebURL?: boolean
  onSelect: (data: {id?: UnpackedHypermediaId; route?: NavRoute; webUrl?: string}) => void
}

type QuerySearchInputComponent = React.ComponentType<QuerySearchInputProps>

const QuerySearchInputContext = createContext<QuerySearchInputComponent | null>(null)

export const QuerySearchInputProvider = QuerySearchInputContext.Provider

export function useQuerySearchInput() {
  return useContext(QuerySearchInputContext)
}
