import {HMAccountsMetadata} from '@shm/shared'
import {useMemo} from 'react'
import {HMIcon} from './hm-icon'
import {Text} from './text'
import {cn} from './utils'

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

  const classNames =
    'dark:border-background dark:bg-background -ml-2 overflow-hidden rounded-full border-2 border-white bg-white'
  return (
    <div className="flex items-center">
      {showAccountIds.map((author, idx) => {
        const authorInfo = accountsMetadata[author]
        if (!authorInfo) return null
        return (
          <div
            key={showAccountIds[idx]}
            className={cn(classNames, `z-${idx + 1}`)}
          >
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
      {accounts.length > 2 ? (
        <div className={cn('flex', classNames)}>
          <Text
            size="xs"
            className="size-6 text-center leading-5 text-gray-400"
            style={{
              fontSize: '10px',
            }}
            weight="medium"
          >
            +{accounts.length - 3}
          </Text>
        </div>
      ) : null}
    </div>
  )
}
