import {hmId, useRouteLink} from '@shm/shared'
import {useAccount} from '@shm/shared/models/entity'
import {HMIcon} from '@shm/ui/hm-icon'
import {CircleUser} from 'lucide-react'
import {useCreateAccount, useLocalKeyPair} from './auth'

export function MyAccountBubble() {
  const keyPair = useLocalKeyPair()
  const myAccount = useAccount(keyPair?.id || undefined)
  const linkProps = useRouteLink(
    keyPair ? {key: 'profile', id: hmId(keyPair.id)} : null,
  )
  if (!myAccount.data) {
    return <CreateAccountBubble />
  }
  return (
    <a
      className="absolute bottom-4 left-4 flex items-center gap-2 rounded-lg bg-white p-2 font-bold shadow-lg transition-colors hover:bg-gray-100"
      {...linkProps}
    >
      {myAccount.data?.id ? (
        <HMIcon
          id={myAccount.data.id}
          name={myAccount.data.metadata?.name}
          icon={myAccount.data.metadata?.icon}
          size={32}
        />
      ) : null}
      {myAccount.data?.metadata?.name}
    </a>
  )
}

export function CreateAccountBubble() {
  const {createAccount, content} = useCreateAccount({
    onClose: () => {},
  })
  return (
    <>
      <button
        className="absolute bottom-4 left-4 flex items-center gap-2 rounded-lg bg-white p-2 font-bold shadow-lg transition-colors hover:bg-gray-100"
        onClick={() => {
          createAccount()
        }}
      >
        <CircleUser className="size-4" />
        Join
      </button>
      {content}
    </>
  )
}
