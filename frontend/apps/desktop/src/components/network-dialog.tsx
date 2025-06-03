import {useDaemonInfo} from '@/models/daemon'
import {ConnectionStatus} from '@shm/shared/client/grpc-types'
import {Button} from '@shm/ui/components/button'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {Copy, NoConnection, Route} from '@shm/ui/icons'
import {List} from '@shm/ui/list'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import React from 'react'
import {ColorValue} from 'react-native'
import {
  ButtonText,
  Dialog,
  SizableText,
  useTheme,
  View,
  XStack,
  XStackProps,
  YStack,
} from 'tamagui'
import {HMPeerInfo, useIsGatewayConnected, usePeers} from '../models/networking'
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
      <XStack jc="flex-end">
        <Button onPress={() => connectDialog.open(true)} icon={Route} size="$2">
          Add Connection
        </Button>
      </XStack>
      <View flexDirection="column" minHeight={500}>
        {peers.data && peers.data.length ? (
          <List
            items={peers.data}
            renderItem={({item: peer}: {item: HMPeerInfo}) => {
              return (
                <PeerRow
                  key={peer.id}
                  peer={peer}
                  myProtocol={deviceInfo?.protocolId}
                />
              )
            }}
          />
        ) : (
          <YStack padding="$4" jc="center" ai="center" gap="$4" f={1}>
            <NoConnection color={theme.color7.val} />
            <SizableText color="$color7" fontWeight="500" size="$5">
              there are no active connections
            </SizableText>
          </YStack>
        )}
        {connectDialog.content}
      </View>
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
    <XStack
      jc="space-between"
      f={1}
      p="$2"
      minHeight={'$2'}
      ai="center"
      group="item"
    >
      <XStack gap="$2" ai="center">
        <Tooltip
          content={
            getPeerStatus(connectionStatus) +
            getProtocolMessage(peer, myProtocol)
          }
        >
          <XStack
            borderRadius={6}
            height={12}
            width={12}
            {...getPeerStatusIndicator(peer, myProtocol)}
            space="$4"
          />
        </Tooltip>
        <Tooltip content="Copy Peer ID">
          <ButtonText onPress={handleCopyPeerId}>
            {id.substring(id.length - 10)}
          </ButtonText>
        </Tooltip>
      </XStack>
      <XStack gap="$3" marginHorizontal="$3">
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
      </XStack>
    </XStack>
  )
})

function getPeerStatus(status: ConnectionStatus) {
  if (status === ConnectionStatus.CONNECTED) return 'Connected'
  if (status === ConnectionStatus.CAN_CONNECT) return 'Can Connect'
  if (status === ConnectionStatus.CANNOT_CONNECT) return 'Cannot Connect'
  if (status === ConnectionStatus.LIMITED) return 'Limited'
  return 'Unknown'
}

function getPeerStatusIndicator(
  peer: HMPeerInfo,
  myProtocol: string,
): XStackProps {
  if (peer.connectionStatus === ConnectionStatus.CONNECTED) {
    if (peer.protocol && peer.protocol !== myProtocol)
      return {backgroundColor: '$yellow10'}
    return {
      backgroundColor: '$green10',
    }
  }
  if (peer.connectionStatus === ConnectionStatus.CAN_CONNECT)
    return {
      backgroundColor: '$backgroundTransparent',
      borderWidth: 1,
      borderStyle: 'dotted',
      borderColor: '$green10',
    }
  if (peer.connectionStatus === ConnectionStatus.CANNOT_CONNECT)
    return {
      backgroundColor: '$backgroundTransparent',
      borderWidth: 1,
      borderStyle: 'dotted',
      borderColor: '$red10',
    }
  if (peer.connectionStatus === ConnectionStatus.LIMITED)
    return {
      backgroundColor: '$backgroundTransparent',
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: '$green10',
    }

  return {backgroundColor: '$gray8'}
}

function IndicationStatus({color}: {color: ColorValue}) {
  return (
    <XStack
      backgroundColor={color}
      borderRadius={6}
      height={12}
      width={12}
      space="$4"
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
    <div className="flex justify-center items-center">
      <Spinner />
    </div>
  )
  if (status === 0) statusDot = <IndicationStatus color="$red9" />
  if (status === 1) statusDot = <IndicationStatus color="$orange9" />
  if (status === 2) statusDot = <IndicationStatus color="$green9" />
  return (
    <Button disabled size="$2">
      {statusDot}
      {label}
    </Button>
  )
}

function GatewayIndicationTag() {
  const gatewayStatus = useIsGatewayConnected()
  let label = 'Gateway'
  if (gatewayStatus === 0) label = 'Gateway Internal Error'
  if (gatewayStatus === 1) label = 'Gateway Unreachable'
  if (gatewayStatus === 2) label = 'Gateway Online'
  return <IndicationTag label={label} status={gatewayStatus} />
}

function NumberBlurb({
  value,
  label,
  backgroundColor,
}: {
  value: number
  label: string
  backgroundColor?: ColorValue
}) {
  return (
    <YStack
      space="$4"
      padding="$2"
      borderRadius="$4"
      ai="center"
      backgroundColor={backgroundColor || '$color4'}
    >
      <SizableText size="$2">{label}</SizableText>
      <SizableText size="$7" fontWeight="bold">
        {value}
      </SizableText>
    </YStack>
  )
}
