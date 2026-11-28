import {useMyAccountIds} from '@/models/daemon'
import {client} from '@/trpc'
import {useQuery} from '@tanstack/react-query'
import {useEffect} from 'react'

/** Returns the local account UIDs whose sites still need Shape Home, rescanning when local accounts change. */
export function useShapeHomeNeedsShaping(): string[] {
  const myAccountIds = useMyAccountIds()
  const state = useQuery({
    queryKey: ['trpc.shapeHome.getState'],
    queryFn: () => client.shapeHome.getState.query(),
  })
  const accountsKey = myAccountIds.data?.join(',')
  useEffect(() => {
    if (accountsKey !== undefined) client.shapeHome.rescan.mutate().catch(() => {})
  }, [accountsKey])
  return state.data?.needsShaping ?? []
}

/** Label-only tag marking an account whose site still needs Shape Home. */
export function ShapeHomeAccountTag() {
  return (
    <span className="bg-brand/10 text-brand w-fit shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase">
      Shape Home
    </span>
  )
}
