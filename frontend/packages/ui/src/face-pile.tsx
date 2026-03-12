import {HMAccountsMetadata} from '@seed-hypermedia/client/hm-types'
import {useMemo} from 'react'
import {HMIcon} from './hm-icon'
import {Text} from './text'
import {cn} from './utils'

export function FacePile({accounts, accountsMetadata}: {accounts: string[]; accountsMetadata: HMAccountsMetadata}) {
  const maxVisible = 3
  const showAccountIds = useMemo(
    () => (accounts.length > maxVisible ? accounts.slice(0, maxVisible) : accounts),
    [accounts],
  )
  const remainingCount = accounts.length - showAccountIds.length

  const overlapClass =
    'dark:border-background dark:bg-background overflow-hidden rounded-full border-2 border-white bg-white'
  return (
    <div className="flex items-center pl-2">
      {showAccountIds.map((author, idx) => {
        const authorInfo = accountsMetadata[author]
        if (!authorInfo) return null
        return (
          <div key={showAccountIds[idx]} className={cn(overlapClass, '-ml-2', `z-${idx + 1}`)}>
            <HMIcon
              key={authorInfo.id.uid}
              id={authorInfo.id}
              name={authorInfo.metadata?.name}
              icon={authorInfo.metadata?.icon}
              size={20}
            />
          </div>
        )
      })}
      {remainingCount > 0 ? (
        <div className={cn('flex', overlapClass, '-ml-2')}>
          <Text
            size="xs"
            className="size-6 text-center leading-5 text-gray-400"
            style={{
              fontSize: '10px',
            }}
            weight="medium"
          >
            +{remainingCount}
          </Text>
        </div>
      ) : null}
    </div>
  )
}
