import {useDaemonInfo} from '@/models/daemon'
import {ConnectionStatus} from '@shm/shared/client/grpc-types'
import {Button} from '@shm/ui/button'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {Copy, NoConnection} from '@shm/ui/icons'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {Route} from 'lucide-react'
import React from 'react'
import {ColorValue} from 'react-native'
import {ButtonText, Dialog, SizableText, useTheme} from 'tamagui'
import {HMPeerInfo, usePeers} from '../models/networking'
import {AddConnectionDialog} from './contacts-prompt'
import {useAppDialog} from './dialog'

export function useNetworkDialog() {
  return useAppDialog<true>(NetworkDialog)
}

export function NetworkDialog() {
  const theme = useTheme()
  const peers = usePeers(false, {
    refetchInterval: 5_000,
  })
  const {data: deviceInfo} = useDaemonInfo()
  const connectDialog = useAppDialog(AddConnectionDialog)

  return (
    <>
      <Dialog.Title>Network Connections</Dialog.Title>
      <div className="flex justify-end">
        <Button onClick={() => connectDialog.open(true)} size="sm">
          <Route className="size-3" />
          Add Connection
        </Button>
      </div>
      <ScrollArea>
        {peers.data && peers.data.length ? (
          peers.data.map((peer) => (
            <PeerRow
              key={peer.id}
              peer={peer}
              myProtocol={deviceInfo?.protocolId || ''}
            />
          ))
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
            <NoConnection color={theme.color7.val} />
            <SizableText color="$color7" fontWeight="500" size="$5">
              there are no active connections
            </SizableText>
          </div>
        )}
        {connectDialog.content}
      </ScrollArea>
    </>
  )
}

function getProtocolMessage(peer: HMPeerInfo, myProtocol: string) {
  if (!peer.protocol || peer.protocol === myProtocol) {
    return ''
  }
  return ` (Protocol: ${peer.protocol})`
}

const PeerRow = React.memo(function PeerRow({
  peer,
  myProtocol,
}: {
  peer: HMPeerInfo
  myProtocol: string
}) {
  const {id, addrs, connectionStatus, protocol} = peer
  // const isSite =
  //   account?.profile?.bio === 'Hypermedia Site. Powered by Mintter.'
  // const label = isSite
  //   ? hostnameStripProtocol(account?.profile?.alias)
  //   : account?.profile?.alias || 'Unknown Account'
  // const spawn = useNavigate('spawn')
  // const openUrl = useOpenUrl()
  // function handlePress() {
  //   if (isSite && account?.profile?.alias) openUrl(account?.profile?.alias)
  //   else if (!isSite && account?.id)
  //     spawn({key: 'document', id: hmId('d', account.id)})
  //   else toast.error('Could not open account')
  // }
  function handleCopyPeerId() {
    copyTextToClipboard(id)
    toast.success('Copied Peer ID')
  }
  const isConnected =
    connectionStatus === ConnectionStatus.CONNECTED && protocol === myProtocol
  return (
    <div className="group flex min-h-8 flex-1 items-center justify-between p-2">
      <div className="flex items-center gap-2">
        <Tooltip
          content={
            getPeerStatus(connectionStatus) +
            getProtocolMessage(peer, myProtocol)
          }
        >
          <div
            className={cn(
              'h-3 w-3 rounded-md',
              getPeerStatusIndicator(peer, myProtocol),
            )}
          />
        </Tooltip>
        <Tooltip content="Copy Peer ID">
          <ButtonText onPress={handleCopyPeerId}>
            {id.substring(id.length - 10)}
          </ButtonText>
        </Tooltip>
      </div>
      <div className="mx-3 flex gap-3">
        {/* <XStack gap="$2">
          {account && !isSite ? (
            <UIAvatar
              size={20}
              onPress={handlePress}
              label={account.profile?.alias}
              url={
                account.profile?.avatar &&
                `${DAEMON_FILE_URL}/${account.profile?.avatar}`
              }
            />
          ) : null}
          <ButtonText
            color={isSite ? '$brand5' : '$gray10'}
            hoverStyle={{
              textDecorationLine: isSite ? 'underline' : 'none',
            }}
            onPress={handlePress}
          >
            {label}
          </ButtonText>
        </XStack> */}
        {isConnected && (
          <SizableText
            size="$1"
            color="$gray10"
            opacity={0}
            $group-item-hover={{opacity: 1}}
          >
            Connected
          </SizableText>
        )}
        {peer.protocol && peer.protocol !== myProtocol && (
          <SizableText
            size="$1"
            color="$gray10"
            opacity={0}
            $group-item-hover={{opacity: 1}}
          >
            Protocol: {peer.protocol.slice(12)}
          </SizableText>
        )}
        <OptionsDropdown
          hiddenUntilItemHover
          menuItems={[
            // {
            //   key: 'open',
            //   icon: isSite ? ExternalLink : ArrowUpRight,
            //   label: isSite ? 'Open Site' : 'Open Account',
            //   onPress: handlePress,
            // },
            // {
            //   key: 'copy',
            //   icon: Copy,
            //   label: 'Copy Peer ID',
            //   onPress: handleCopyPeerId,
            // },
            {
              key: 'copyAddress',
              icon: Copy,
              label: 'Copy Addresses',
              onPress: () => {
                copyTextToClipboard(addrs.join(','))
                toast.success('Copied Peer Addresses')
              },
            },
          ]}
        />
      </div>
    </div>
  )
})

function getPeerStatus(status: ConnectionStatus) {
  if (status === ConnectionStatus.CONNECTED) return 'Connected'
  if (status === ConnectionStatus.CAN_CONNECT) return 'Can Connect'
  if (status === ConnectionStatus.CANNOT_CONNECT) return 'Cannot Connect'
  if (status === ConnectionStatus.LIMITED) return 'Limited'
  return 'Unknown'
}

function getPeerStatusIndicator(peer: HMPeerInfo, myProtocol: string): string {
  if (peer.connectionStatus === ConnectionStatus.CONNECTED) {
    if (peer.protocol && peer.protocol !== myProtocol) return 'bg-yellow-500'
    return 'bg-green-500'
  }
  if (peer.connectionStatus === ConnectionStatus.CAN_CONNECT)
    return 'bg-transparent border border-dotted border-green-500'
  if (peer.connectionStatus === ConnectionStatus.CANNOT_CONNECT)
    return 'bg-transparent border border-dotted border-red-500'
  if (peer.connectionStatus === ConnectionStatus.LIMITED)
    return 'bg-transparent border border-dashed border-green-500'

  return 'bg-muted-foreground'
}

function IndicationStatus({color}: {color: ColorValue}) {
  return (
    <div
      className="h-3 w-3 rounded-md"
      style={{backgroundColor: color as string}}
    />
  )
}

function IndicationTag({
  label,
  status,
}: {
  label: string
  status: null | 0 | 1 | 2
}) {
  let statusDot = (
    <div className="flex items-center justify-center">
      <Spinner />
    </div>
  )
  if (status === 0) statusDot = <IndicationStatus color="$red9" />
  if (status === 1) statusDot = <IndicationStatus color="$orange9" />
  if (status === 2) statusDot = <IndicationStatus color="$green9" />
  return (
    <Button disabled size="sm">
      {statusDot}
      {label}
    </Button>
  )
}
