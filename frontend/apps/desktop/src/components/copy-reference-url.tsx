import {PushResourceStatus, usePushResource} from '@/models/documents'
import {UnpackedHypermediaId} from '@shm/shared'
import {useStream} from '@shm/shared/use-stream'
import {createWebHMUrl, packHmId} from '@shm/shared/utils/entity-id-url'
import {NavigationContext} from '@shm/shared/utils/navigation'
import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
import {Button} from '@shm/ui/button'
import {CheckboxField} from '@shm/ui/components/checkbox'
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {ReactNode, useState} from 'react'
import {
  usePushOnCopy,
  useSetPushOnCopy,
  useSetPushOnPublish,
} from '../models/gateway-settings'
type IsPublishedState = null | boolean // null: determined checked yet

export function useCopyReferenceUrl(
  hostname: string,
  originHomeId?: UnpackedHypermediaId | undefined,
  overrideNav?: NavigationContext,
) {
  const dialog = useAppDialog(PushToGatewayDialog, {
    overrideNavigation: overrideNav,
  })
  const pushOnCopy = usePushOnCopy()
  const pushResource = usePushResource()
  function onCopy(input: UnpackedHypermediaId) {
    const url = createWebHMUrl(input.uid, {
      version: input.version,
      blockRef: input.blockRef,
      blockRange: input.blockRange,
      hostname,
      path: input.path,
      latest: input.latest,
      originHomeId,
    })
    copyTextToClipboard(url)
    if (pushOnCopy.data === 'never') {
      return
    }
    const [setPushStatus, pushStatus] =
      writeableStateStream<PushResourceStatus | null>(null)

    const publishPromise = pushResource(input, hostname, (status) => {
      setPushStatus(status)
    })
    toast.promise(publishPromise, {
      loading: `Pushing to ${hostname}`,
      success: (
        <CopiedToast
          pushStatus={pushStatus}
          host={hostname}
          hmId={packHmId(input)}
        />
      ),
      error: (
        <CopiedToast
          pushStatus={pushStatus}
          host={hostname}
          hmId={packHmId(input)}
        />
      ),
    })
  }
  return [dialog.content, onCopy] as const
}

function CopiedToast({
  pushStatus,
  host,
  hmId,
}: {
  pushStatus: StateStream<PushResourceStatus | null>
  host: string
  hmId: string
}) {
  const status = useStream(pushStatus)
  let indicator: ReactNode = null
  let message: ReactNode = ''
  if (status === null) {
    indicator = (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
    message = <>{JSON.stringify(status)}</>
  }
  // else if (published === true) {
  //   message = (
  //     <>
  //       Copied URL, available on <b>{host}</b>
  //     </>
  //   )
  // } else if (published === false) {
  //   message = (
  //     <>
  //       Copied URL, failed to push to <b>{host}</b>
  //     </>
  //   )
  // }
  return message
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
