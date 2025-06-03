import {HMAccountsMetadata} from '@shm/shared'
import {useMemo} from 'react'
import {HMIcon} from './hm-icon'

export function FacePile({
  accounts,
  accountsMetadata,
}: {
  accounts: string[]
  accountsMetadata: HMAccountsMetadata
}) {
  const showAccountIds = useMemo(
    () => (accounts.length > 3 ? accounts.slice(0, 2) : accounts),
    [accounts],
  )

  return (
    <div
      className="*:data-[slot=avatar]:ring-background flex items-center -space-x-2 *:data-[slot=avatar]:ring-2"
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        console.log('showAccountIds', showAccountIds)
      }}
    >
      {showAccountIds.map((author) => {
        const authorInfo = accountsMetadata[author]
        if (!authorInfo) return null
        return (
          <HMIcon
            key={authorInfo.id.uid}
            id={authorInfo.id}
            metadata={authorInfo.metadata}
            size={20}
          />
        )
      })}
      {accounts.length > 3 ? (
        <div className="z-[100] border-white dark:border-black bg-background border-2 rounded-full transition-all duration-200 ease-in-out size-[24px] flex items-center justify-center">
          <span className="text-[10px] font-bold text-gray-600 dark:text-gray-400">
            +{accounts.length - 2}
          </span>
        </div>
      ) : null}
    </div>
  )
}
