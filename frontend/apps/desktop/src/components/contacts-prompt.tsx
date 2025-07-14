import {useGatewayUrl} from '@/models/gateway-settings'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {Button} from '@shm/ui/button'
import {Textarea} from '@shm/ui/components/textarea'
import {CopyUrlField} from '@shm/ui/copy-url-field'
import {UserPlus} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {base58btc} from 'multiformats/bases/base58'
import {useMemo, useState} from 'react'
import appError from '../errors'
import {useConnectPeer} from '../models/contacts'
import {useDaemonInfo} from '../models/daemon'
import {usePeerInfo} from '../models/networking'
import {DialogClose, DialogDescription, DialogTitle} from './dialog'

export function AddConnectionDialog({
  input,
  onClose,
}: {
  onClose: () => void
  input: true
}) {
  const [peerText, setPeer] = useState('')
  const daemonInfo = useDaemonInfo()
  const deviceId = daemonInfo.data?.peerId
  const peerInfo = usePeerInfo(deviceId)
  const gatewayUrl = useGatewayUrl()

  const connect = useConnectPeer({
    onSuccess: () => {
      onClose()
      toast.success('Connection Added')
    },
    onError: (error) => {
      appError(`Connect to peer error: ${error?.rawMessage}`, {error})
    },
  })
  const connectInfo = useMemo(() => {
    if (!deviceId || !peerInfo.data?.addrs?.length) return null
    return base58btc.encode(
      cborEncode({
        a: peerInfo.data?.addrs.map((addr) => {
          return addr.split('/p2p/').slice(0, -1).join('/p2p/')
        }),
        d: deviceId,
      }),
    )
  }, [
    deviceId,
    peerInfo.data?.addrs?.length, // explicitly using addrs length because the address list is being polled and frequently changes order, which does not affect connecivity
  ])
  return (
    <>
      <DialogTitle>Direct Peer Connection</DialogTitle>
      <DialogClose />

      <DialogDescription>
        Share your device connection URL with someone who you want to connect
        with:{' '}
      </DialogDescription>
      {deviceId && (
        <CopyUrlField
          label="Device Connection URL"
          url={`${gatewayUrl.data}/hm/connect#${connectInfo}`}
        />
      )}
      <DialogDescription>
        Paste other people&apos;s connection URL here:
      </DialogDescription>
      <Textarea
        value={peerText}
        onChange={(e) => setPeer(e.target.value)}
        rows={4}
        data-testid="add-contact-input"
      />
      <DialogDescription size={'$1'}>
        You can also paste the full peer address here.
      </DialogDescription>

      <div className="flex justify-between">
        <Button
          onClick={() => connect.mutate(peerText)}
          disabled={!peerText}
          variant="default"
          size="sm"
        >
          <UserPlus className="size-3" />
          Connect to Peer
        </Button>
        {connect.isLoading ? (
          <div className="flex items-center justify-center">
            <Spinner />
          </div>
        ) : null}
      </div>
    </>
  )
}
