import {HMMetadataPayload} from '@seed-hypermedia/client/hm-types'
import {useRootDocuments} from '@shm/shared/models/entity'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {AccountSearchResult, AccountTagInput, AccountTagInputItem} from '@shm/ui/account-tag-input'
import {SizableText} from '@shm/ui/text'
import {useMemo, useState} from 'react'

type QueryAccountFilterInputProps = {
  selectedUids: string[]
  onSelectedUidsChange: (uids: string[]) => void
}

function accountLabel(account: HMMetadataPayload | undefined, uid: string) {
  return account?.metadata?.name || abbreviateUid(uid)
}

function accountToResult(account: HMMetadataPayload): AccountSearchResult {
  return {
    id: account.id,
    label: accountLabel(account, account.id.uid),
    metadata: account.metadata ?? undefined,
  }
}

export function QueryAccountFilterInput({selectedUids, onSelectedUidsChange}: QueryAccountFilterInputProps) {
  const [search, setSearch] = useState('')
  const accounts = useRootDocuments()
  const accountByUid = useMemo(() => {
    return new Map((accounts.data?.accounts ?? []).map((account) => [account.id.uid, account]))
  }, [accounts.data?.accounts])
  const selectedUidSet = useMemo(() => new Set(selectedUids), [selectedUids])
  const searchTerm = search.trim().toLowerCase()

  const selectedAccounts = useMemo<AccountSearchResult[]>(() => {
    return selectedUids.map((uid) => {
      const account = accountByUid.get(uid)
      if (account) return accountToResult(account)
      return {id: hmId(uid), label: abbreviateUid(uid)}
    })
  }, [accountByUid, selectedUids])

  const matches = useMemo(() => {
    if (!searchTerm) return []
    return (accounts.data?.accounts ?? [])
      .filter((account) => {
        if (selectedUidSet.has(account.id.uid)) return false
        const name = account.metadata?.name?.toLowerCase() ?? ''
        return name.includes(searchTerm)
      })
      .sort((a, b) =>
        accountLabel(a, a.id.uid).localeCompare(accountLabel(b, b.id.uid), undefined, {sensitivity: 'base'}),
      )
      .slice(0, 8)
      .map(accountToResult)
  }, [accounts.data?.accounts, searchTerm, selectedUidSet])

  return (
    <div className="flex flex-col gap-1">
      <SizableText size="sm" color="muted">
        Author accounts
      </SizableText>
      <div className="border-border bg-background rounded-md border">
        <AccountTagInput
          label="Author accounts"
          value={search}
          onChange={setSearch}
          values={selectedAccounts}
          onValuesChange={(values) => onSelectedUidsChange(values.map((value) => value.id.uid))}
          placeholder={selectedUids.length ? 'Add author…' : 'Search profile name…'}
        >
          {matches.map((account) => (
            <AccountTagInputItem
              key={account.id.uid}
              account={account}
              onClick={() => {
                onSelectedUidsChange([...selectedUids, account.id.uid])
                setSearch('')
              }}
            >
              Add &quot;{account.label}&quot;
            </AccountTagInputItem>
          ))}
          {searchTerm && !matches.length ? (
            <div className="text-muted-foreground px-3 py-2 text-sm">
              {accounts.isLoading ? 'Searching accounts…' : 'No accounts match that profile name.'}
            </div>
          ) : null}
        </AccountTagInput>
      </div>
    </div>
  )
}
