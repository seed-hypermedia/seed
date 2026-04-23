import {usePushAfterAction} from '@/models/push-after-action'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {NavRoute, routeToUrl} from '@shm/shared'
import {NavigationContext} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {CheckboxField} from '@shm/ui/components/checkbox'
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useState} from 'react'
import {useSetPushOnCopy, useSetPushOnPublish} from '../models/gateway-settings'

export function useCopyReferenceUrl(
  hostname: string,
  originHomeId?: UnpackedHypermediaId | undefined,
  overrideNav?: NavigationContext,
) {
  const dialog = useAppDialog(PushToGatewayDialog, {
    overrideNavigation: overrideNav,
  })
  const pushAfterAction = usePushAfterAction()
  function onCopy(route: NavRoute) {
    console.log('== onCopy routeToUrl', route, {hostname, originHomeId})
    const url = routeToUrl(route, {
      hostname,
      originHomeId,
    })
    copyTextToClipboard(url)
    const pushId = route.key === 'document' ? route.id : null
    if (pushId) {
      pushAfterAction({id: pushId, trigger: 'copy', onlyPushToHost: hostname})
    }
  }
  return [dialog.content, onCopy] as const
}

export function PushToGatewayDialog({
  input,
  onClose,
}: {
  input: {
    host: string
    context: 'copy' | 'publish'
  } & UnpackedHypermediaId
  onClose: () => void
}) {
  const [shouldDoAlways, setShouldDoAlways] = useState(false)
  const setPushOnCopy = useSetPushOnCopy()
  const setPushOnPublish = useSetPushOnPublish()
  const entityType = 'Document'
  function setDoEveryTime(everyTime: 'always' | 'never') {
    if (input.context === 'copy') {
      setPushOnCopy.mutate(everyTime)
    } else if (input.context === 'publish') {
      setPushOnPublish.mutate(everyTime)
    }
  }
  let title = `Push to ${input.host}`
  let description = `Push this ${entityType.toLowerCase()} to the public web gateway?`
  if (input.context === 'copy') {
    title = `${entityType} URL Copied. Push to ${input.host}?`
    description = `Could not verify this ${entityType.toLowerCase()} is publicly available. Would you like to push it now?`
  } else if (input.context === 'publish') {
    title = `${entityType} Published. Push to ${input.host}?`
  }
  return (
    <>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      <CheckboxField
        checked={shouldDoAlways}
        id="do-every-time"
        onCheckedChange={(checked: boolean) => setShouldDoAlways(checked)}
      >
        Do this every time
      </CheckboxField>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (shouldDoAlways) setDoEveryTime('never')
            onClose()
          }}
        >
          Dismiss
        </Button>
      </div>
    </>
  )
}
