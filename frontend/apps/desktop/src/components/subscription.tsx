import {useMyAccountIds} from '@/models/daemon'
import {HMSubscription, useSubscription} from '@/models/subscription'
import {getDocumentTitle} from '@shm/shared/content'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {Button, buttonVariants} from '@shm/ui/button'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@shm/ui/components/alert-dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {
  Check,
  ChevronDown,
  CircleOff,
  Folder,
  Subscribe,
  SubscribeSpace,
} from '@shm/ui/icons'
import {SizableText, Text} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {usePopoverState} from '@shm/ui/use-popover-state'

import {cn} from '@shm/ui/utils'
import {VariantProps} from 'class-variance-authority'
import {useAppDialog} from './dialog'

export function SubscriptionButton({id}: {id: UnpackedHypermediaId}) {
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
      <Popover {...popoverState}>
        <Tooltip
          content={
            subscription.subscription != 'none'
              ? `Subscribe to ${
                  subscription.subscription == 'space' ? 'Site' : 'Document'
                }`
              : ''
          }
        >
          <PopoverTrigger>
            <Button size="xs" variant={isSubscribed ? 'outline' : 'brand'}>
              {subscription.subscription == 'space' ? (
                <SubscribeSpace size={20} className="text-brand-5" />
              ) : subscription.subscription == 'document' ? (
                <Subscribe size={20} className="text-brand-5" />
              ) : undefined}
              {subscription.subscription == 'none' ? 'Subscribe' : 'Subscribed'}
              <ChevronDown className="size-4" />
            </Button>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent className="p-1" align="end" side="bottom">
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
                onClick={() => {
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
                onClick={() => {
                  subscription.setSubscription('document')
                  popoverState.onOpenChange(false)
                }}
              />
            </>
          )}
          {subscription.subscription != 'none' ? (
            <SubscriptionOptionButton
              variant="destructive"
              Icon={CircleOff}
              title="Unsubscribe"
              onClick={() => {
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
        </PopoverContent>
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
    <>
      <AlertDialogTitle>Unsubscribe from "{title}"</AlertDialogTitle>
      <AlertDialogDescription>
        You will unsubscribe from this whole space.
      </AlertDialogDescription>

      <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
      <AlertDialogAction
        variant="destructive"
        onClick={() => {
          input.onConfirm()
          onClose()
        }}
      >
        {`Unsubscribe From ${title}`}
      </AlertDialogAction>
    </>
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
  onClick,
  variant,
  size,
  className,
}: {
  Icon: any
  title: string
  description?: string
  active?: boolean
  onClick?: () => void
  className?: string
} & VariantProps<typeof buttonVariants>) {
  let icon = null
  if (active) {
    icon = <Check size={24} className="text-brand-4" />
  } else if (Icon) {
    icon = <Icon size={24} />
  }
  return (
    <Button
      className={cn(
        'flex h-auto w-full items-start justify-start gap-3 p-3',
        className,
      )}
      onClick={onClick}
      disabled={active}
      variant={variant}
      size={size}
    >
      <div className="h-5 shrink-0 pt-0.5">{icon}</div>
      <div className="flex-1">
        <Text weight="bold" className="block h-5 text-left whitespace-normal">
          {title}
        </Text>

        {description ? (
          <SizableText
            size="sm"
            className="text-muted-foreground block text-left text-sm whitespace-normal"
          >
            {description}
          </SizableText>
        ) : null}
      </div>
    </Button>
  )
}
