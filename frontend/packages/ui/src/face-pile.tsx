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
              'border-2 border-white dark: border-background bg-white dark:bg-background rounded-full overflow-hidden -ml-2',
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
            'size-6 border-2 border-white dark: border-background bg-white dark:bg-background rounded-full overflow-hidden -ml-2 flex items-center justify-center z-5',
          )}
        >
          <Text
            size="xs"
            className="text-gray-400 leading-5 size-6 text-center"
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
