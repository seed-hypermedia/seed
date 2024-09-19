import {usePublishToSite} from '@/models/documents'
import {
  HYPERMEDIA_ENTITY_TYPES,
  StateStream,
  UnpackedHypermediaId,
  writeableStateStream,
} from '@shm/shared'
import {createWebHMUrl, packHmId} from '@shm/shared/src/utils/entity-id-url'
import {
  Button,
  CheckboxField,
  copyTextToClipboard,
  DialogDescription,
  ErrorToastDecoration,
  Hostname,
  SizableText,
  Spinner,
  SuccessToastDecoration,
  toast,
  useStream,
  XStack,
  YStack,
} from '@shm/ui'
import {ReactNode, useState} from 'react'
import {
  usePushOnCopy,
  useSetPushOnCopy,
  useSetPushOnPublish,
} from '../models/gateway-settings'
import {DialogTitle, useAppDialog} from './dialog'

type IsPublishedState = null | boolean // null: determined checked yet

export function useCopyReferenceUrl(hostname: string) {
  const dialog = useAppDialog(PushToGatewayDialog)
  const pushOnCopy = usePushOnCopy()
  const publishToSite = usePublishToSite()
  function onCopy(input: UnpackedHypermediaId) {
    const url = createWebHMUrl(input.type, input.uid, {
      version: input.version,
      blockRef: input.blockRef,
      blockRange: input.blockRange,
      hostname,
      path: input.path,
    })
    const [setIsPublished, isPublished] =
      writeableStateStream<IsPublishedState>(null)
    if (pushOnCopy.data === 'never') {
      setIsPublished(false)
    }
    const {close} = toast.custom(
      <CopiedToast
        host={hostname}
        isPublished={isPublished}
        hmId={packHmId(input)}
      />,
      {duration: 4000, waitForClose: isPublished.get() === null},
    )
    publishToSite(input, hostname)
      .then((didPublish) => {
        if (didPublish) {
          setIsPublished(true)
        } else {
          setIsPublished(false)
        }
      })
      .catch((e) => {
        toast.error('Failed to Publish: ' + e.message)
        setIsPublished(false)
      })
      .finally(() => {
        close()
      })
    copyTextToClipboard(url)
  }
  return [dialog.content, onCopy] as const
}

function CopiedToast({
  isPublished,
  host,
  hmId,
}: {
  isPublished: StateStream<IsPublishedState>
  host: string
  hmId: string
}) {
  const published = useStream(isPublished)
  let indicator: ReactNode = null
  let message: ReactNode = ''
  if (published === null) {
    indicator = <Spinner />
    message = (
      <>
        Copied URL, pushing to <Hostname host={host} />
      </>
    )
  } else if (published === true) {
    indicator = <SuccessToastDecoration />
    message = (
      <>
        Copied URL, available on <Hostname host={host} />
      </>
    )
  } else if (published === false) {
    indicator = <ErrorToastDecoration />
    message = (
      <>
        Copied URL, failed to push to <Hostname host={host} />
      </>
    )
  }
  return (
    <YStack f={1} gap="$3">
      <XStack gap="$4" ai="center">
        {indicator}
        <SizableText flexWrap="wrap">{message}</SizableText>
      </XStack>
    </YStack>
  )
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
  const entityType = input?.type
    ? HYPERMEDIA_ENTITY_TYPES[input.type]
    : 'Entity'
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
        value={shouldDoAlways}
        id="do-every-time"
        onValue={(checked) => setShouldDoAlways(checked)}
      >
        Do this every time
      </CheckboxField>
      <XStack gap="$1">
        {/* <Button
          theme="green"
          size="$2"
          iconAfter={push.isLoading ? <Spinner /> : null}
          onPress={() => {
            if (shouldDoAlways) setDoEveryTime('always')
            push
              .mutateAsync(packHmId(input))
              .then(() => {
                onClose()
                toast.success(`Pushed to ${input.host}`)
              })
              .catch((e) => {
                toast.error(`Failed to push to ${input.host}: ${e.message}`)
              })
          }}
        >
          Push to Web
        </Button> */}
        <Button
          chromeless
          size="$2"
          onPress={() => {
            if (shouldDoAlways) setDoEveryTime('never')
            onClose()
          }}
        >
          Dismiss
        </Button>
      </XStack>
    </>
  )
}
