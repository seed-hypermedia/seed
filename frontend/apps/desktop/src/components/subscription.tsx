import {useMyAccountIds} from '@/models/daemon'
import {HMSubscription, useSubscription} from '@/models/subscription'
import {getDocumentTitle} from '@shm/shared/content'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {
  Check,
  ChevronDown,
  CircleOff,
  Folder,
  Subscribe,
  SubscribeSpace,
} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {
  AlertDialog,
  Button,
  ColorTokens,
  Popover,
  Text,
  useTheme,
  XStack,
  YStack,
} from 'tamagui'
import {useAppDialog} from './dialog'

export function SubscriptionButton({id}: {id: UnpackedHypermediaId}) {
  const theme = useTheme()
  const subscription = useSubscription(id)
  const myAccountIds = useMyAccountIds()
  const docIsInMyAccount = myAccountIds.data?.includes(id.uid)
  const popoverState = usePopoverState()
  const unsubscribeParent = useAppDialog(UnsubscribeParentDialog, {
    isAlert: true,
  })

  const isSubscribed = ['space', 'document'].includes(subscription.subscription)

  if (docIsInMyAccount) {
    return null
  }

  return (
    <>
      <Popover {...popoverState} placement="bottom-end">
        <Tooltip
          content={
            subscription.subscription != 'none'
              ? `Subscribe to ${
                  subscription.subscription == 'space' ? 'Site' : 'Document'
                }`
              : ''
          }
        >
          <Popover.Trigger asChild>
            <Button
              size="$2"
              backgroundColor={
                isSubscribed ? '$backgroundTransparent' : '$brand5'
              }
              color={isSubscribed ? '$brand5' : 'white'}
              borderColor={isSubscribed ? '$brand6' : '$colorTransparent'}
              iconAfter={ChevronDown}
              borderWidth={1}
              pressStyle={{
                borderWidth: 1,
                bg: isSubscribed ? '$backgroundTransparent' : '$brand4',
              }}
              focusStyle={{borderWidth: 1}}
              hoverStyle={
                isSubscribed
                  ? {
                      bg: '$backgroundTransparent',
                      borderColor: '$brand6',
                    }
                  : {
                      bg: '$brand4',
                      borderColor: '$colorTransparent',
                    }
              }
              icon={
                subscription.subscription == 'space' ? (
                  <SubscribeSpace size={20} color={theme.brand5.val} />
                ) : subscription.subscription == 'document' ? (
                  <Subscribe size={20} color={theme.brand5.val} />
                ) : undefined
              }
            >
              {subscription.subscription == 'none' ? 'Subscribe' : 'Subscribed'}
            </Button>
          </Popover.Trigger>
        </Tooltip>
        <Popover.Content
          padding={0}
          elevation="$2"
          animation={[
            'fast',
            {
              opacity: {
                overshootClamping: true,
              },
            },
          ]}
          enterStyle={{y: -10, opacity: 0}}
          exitStyle={{y: -10, opacity: 0}}
        >
          <YStack
            maxWidth={300}
            overflow="hidden"
            borderRadius="$4"
            className="shadow-md"
          >
            {subscription.parentSubscription ? (
              <ParentSubscription sub={subscription.parentSubscription} />
            ) : (
              <>
                <SubscriptionOptionButton
                  Icon={SubscribeSpace}
                  active={subscription.subscription == 'space'}
                  title={`${
                    subscription.subscription == 'space'
                      ? 'Subscribed'
                      : 'Subscribe'
                  } to Site`}
                  description="Receive the latest updates of this document and the full directory"
                  onPress={() => {
                    subscription.setSubscription('space')
                    popoverState.onOpenChange(false)
                  }}
                />
                <SubscriptionOptionButton
                  Icon={Subscribe}
                  active={subscription.subscription == 'document'}
                  title={`${
                    subscription.subscription == 'document'
                      ? 'Subscribed'
                      : 'Subscribe'
                  } to Document`}
                  description="Receive the latest updates of this document"
                  onPress={() => {
                    subscription.setSubscription('document')
                    popoverState.onOpenChange(false)
                  }}
                />
              </>
            )}
            {subscription.subscription != 'none' ? (
              <SubscriptionOptionButton
                color={theme.red9.val}
                Icon={CircleOff}
                title="Unsubscribe"
                onPress={() => {
                  if (subscription.parentSubscription) {
                    unsubscribeParent.open({
                      id: subscription.parentSubscription.id,
                      onConfirm: () => {
                        subscription.unsubscribeParent()
                      },
                    })
                  } else {
                    subscription.setSubscription('none')
                  }
                  popoverState.onOpenChange(false)
                }}
              />
            ) : null}
          </YStack>
        </Popover.Content>
      </Popover>
      {unsubscribeParent.content}
    </>
  )
}

function UnsubscribeParentDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {id: UnpackedHypermediaId; onConfirm: () => void}
}) {
  const entity = useResource(input.id)
  const document =
    entity.data?.type === 'document' ? entity.data.document : undefined
  const title = getDocumentTitle(document)

  return (
    <YStack space backgroundColor="$background" padding="$4" borderRadius="$3">
      <AlertDialog.Title>Unsubscribe from "{title}"</AlertDialog.Title>
      <AlertDialog.Description>
        You will unsubscribe from this whole space.
      </AlertDialog.Description>

      <XStack space="$3" justifyContent="flex-end">
        <AlertDialog.Cancel asChild>
          <Button
            onPress={() => {
              onClose()
            }}
            chromeless
          >
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <AlertDialog.Action asChild>
          <Button
            theme="red"
            onPress={() => {
              input.onConfirm()
              onClose()
            }}
          >
            {`Unsubscribe From ${title}`}
          </Button>
        </AlertDialog.Action>
      </XStack>
    </YStack>
  )
}

function ParentSubscription({sub}: {sub: HMSubscription}) {
  const entity = useResource(sub.id)
  const document =
    entity.data?.type === 'document' ? entity.data.document : undefined
  const title = getDocumentTitle(document)
  if (!title) return
  return (
    <SubscriptionOptionButton
      Icon={Folder}
      active={true}
      title={`Subscribed to ${title}`}
      description="This document is part of a Site you are subscribed to"
    />
  )
}

function SubscriptionOptionButton({
  Icon,
  title,
  description,
  active,
  onPress,
  color,
}: {
  Icon: React.FC<{size?: number; color?: ColorTokens | string}>
  title: string
  description?: string
  active?: boolean
  onPress?: () => void
  color?: ColorTokens | string
}) {
  const theme = useTheme()
  let icon = null
  if (active) {
    icon = <Check size={20} color={theme.brand4.val} />
  } else if (Icon) {
    icon = <Icon size={20} color={theme.color.val} />
  }
  return (
    <Button
      height="auto"
      onPress={onPress}
      disabled={active}
      borderRadius={0}
      pressStyle={{
        backgroundColor: '$colorTransparent',
        borderColor: '$colorTransparent',
      }}
      hoverStyle={{
        backgroundColor: '$backgroundFocus',
        borderColor: '$colorTransparent',
        outlineColor: '$colorTransparent',
      }}
      padding="$3"
    >
      <XStack gap="$3" f={1} ai="flex-start">
        <XStack flexShrink={0} flexGrow={0}>
          {icon}
        </XStack>
        <YStack f={1} gap="$1.5">
          <XStack f={1} height={20} ai="center">
            <Text
              fontSize={14}
              fontWeight="bold"
              color={active ? theme.brand4 : color}
            >
              {title}
            </Text>
          </XStack>

          {description ? <Text fontSize={12}>{description}</Text> : null}
        </YStack>
      </XStack>
    </Button>
  )
}
