import {HMAccountsMetadata} from '@shm/shared'
import {XStack} from '@tamagui/stacks'
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
  return (
    <div className="flex items-center">
      {showAccountIds.map((author, idx) => {
        const authorInfo = accountsMetadata[author]
        if (!authorInfo) return null
        return (
          <div
            key={showAccountIds[idx]}
            className={cn(
              `z-${idx + 1}`,
              'dark: border-background dark:bg-background -ml-2 overflow-hidden rounded-full border-2 border-white bg-white',
            )}
          >
            <HMIcon
              key={authorInfo.id.uid}
              id={authorInfo.id}
              metadata={authorInfo.metadata}
              size={20}
            />
          </div>
        )
      })}
      {accounts.length > 2 ? (
        <XStack
          className={cn(
            'dark: border-background dark:bg-background z-5 -ml-2 flex size-6 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white',
          )}
        >
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
        </XStack>
      ) : null}
    </div>
  )
}
