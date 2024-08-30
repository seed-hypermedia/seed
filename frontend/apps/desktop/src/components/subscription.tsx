import {useEntity} from '@/models/entities'
import {HMSubscription, useSubscription} from '@/models/subscription'
import {usePopoverState} from '@/use-popover-state'
import {getDocumentTitle, UnpackedHypermediaId} from '@shm/shared'
import {
  AlertDialog,
  Button,
  ChevronDown,
  ColorTokens,
  File,
  Popover,
  Text,
  XStack,
  YStack,
} from '@shm/ui'
import {Check, CircleOff, Folder} from '@tamagui/lucide-icons'
import {useAppDialog} from './dialog'

export function SubscriptionButton({id}: {id: UnpackedHypermediaId}) {
  const subscription = useSubscription(id)
  const popoverState = usePopoverState()
  const unsubscribeParent = useAppDialog(UnsubscribeParentDialog, {
    isAlert: true,
  })

  return (
    <>
      <Popover {...popoverState} placement="bottom-end">
        <Popover.Trigger asChild>
          <Button
            size="$2"
            theme="blue"
            backgroundColor="$blue5"
            iconAfter={ChevronDown}
          >
            {subscription.subscription === 'none' ? 'Subscribe' : 'Subscribed'}
          </Button>
        </Popover.Trigger>
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
          elevate={true}
        >
          <YStack gap="$2" padding="$2">
            {subscription.parentSubscription ? (
              <ParentSubscription sub={subscription.parentSubscription} />
            ) : (
              <>
                <SubscriptionOptionButton
                  Icon={Folder}
                  active={subscription.subscription === 'space'}
                  title={`${
                    subscription.subscription === 'space'
                      ? 'Subscribed'
                      : 'Subscribe'
                  } to Space`}
                  description="Receive the latest updates of this document and the full directory"
                  onPress={() => {
                    subscription.setSubscription('space')
                    popoverState.onOpenChange(false)
                  }}
                />
                <SubscriptionOptionButton
                  Icon={File}
                  active={subscription.subscription === 'document'}
                  title={`${
                    subscription.subscription === 'document'
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
            {subscription.subscription !== 'none' ? (
              <SubscriptionOptionButton
                color={'$red9'}
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
  const entity = useEntity(input.id)
  const title = getDocumentTitle(entity.data?.document)

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
  const entity = useEntity(sub.id)
  const title = getDocumentTitle(entity.data?.document)
  if (!title) return
  return (
    <SubscriptionOptionButton
      Icon={Folder}
      active={true}
      title={`Subscribed to ${title}`}
      description="This document is part of a Space you are subscribed to"
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
  Icon: React.FC<{color?: ColorTokens}>
  title: string
  description?: string
  active?: boolean
  onPress?: () => void
  color?: ColorTokens
}) {
  let icon = null
  if (active) {
    icon = <Check color="$blue10" />
  } else if (Icon) {
    icon = <Icon color={color} />
  }
  return (
    <Button
      height="$7"
      onPress={onPress}
      disabled={active}
      cursor={active ? 'default' : 'pointer'}
      pressStyle={
        active
          ? {
              backgroundColor: '$colorTransparent',
              borderColor: '$colorTransparent',
            }
          : {}
      }
      hoverStyle={active ? {borderColor: '$colorTransparent'} : {}}
    >
      <XStack gap="$4" f={1} ai="center">
        {icon}
        <YStack gap="$2" f={1}>
          <Text
            fontWeight="bold"
            fontSize="$3"
            color={active ? '$blue10' : color}
          >
            {title}
          </Text>
          {description ? (
            <Text fontSize="$3" color="$color9">
              {description}
            </Text>
          ) : null}
        </YStack>
      </XStack>
    </Button>
  )
}
