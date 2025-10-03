import {useLinkDevice, useLinkDeviceStatus} from '@/models/linked-devices'
import {zodResolver} from '@hookform/resolvers/zod'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {DeviceLinkSession} from '@shm/shared/hm-types'
import {Button} from '@shm/ui/button'
import {DialogTitle} from '@shm/ui/components/dialog'
import {FormInput} from '@shm/ui/form-input'
import {FormField} from '@shm/ui/forms'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {Check, Copy} from 'lucide-react'
import {base58btc} from 'multiformats/bases/base58'
import {useEffect, useMemo, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useForm} from 'react-hook-form'
import QRCode from 'react-qr-code'
import {z} from 'zod'

export function LinkDeviceDialog({
  input,
  onClose,
}: {
  input: {accountUid: string; accountName: string; origin?: string}
  onClose: () => void
}) {
  const [linkDeviceToken, setLinkDeviceToken] = useState<null | string>(null)
  const [linkSession, setLinkSession] = useState<null | DeviceLinkSession>(null)
  const [copied, setCopied] = useState(false)
  const linkDeviceStatus = useLinkDeviceStatus(!!linkSession)

  if (!linkSession && !linkDeviceToken) {
    return (
      <>
        <DialogTitle>Link New Signing Key</DialogTitle>
        <DeviceLabelForm
          accountUid={input.accountUid}
          origin={input.origin}
          onSuccess={async (linkSession) => {
            setLinkSession(linkSession)
            const token = base58btc.encode(cborEncode(linkSession))
            setLinkDeviceToken(token)
          }}
        />
      </>
    )
  }

  const linkCompleted =
    linkDeviceToken &&
    linkDeviceStatus.data?.redeemTime &&
    linkSession &&
    linkDeviceStatus.data?.secretToken === linkSession.secretToken

  if (linkCompleted) {
    return (
      <>
        <DialogTitle>Device Linked!</DialogTitle>
        <div className="flex flex-col gap-4">
          <p>
            You have signed in to{' '}
            <SizableText weight="bold">{input.accountName}</SizableText> in the
            web browser.
          </p>
          <div className="flex justify-center">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onClose()
              }}
            >
              Close
              <Check className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </>
    )
  }

  if (!linkDeviceToken) {
    // Making TS happy with this check.
    throw new Error('BUG: Unreachable')
  }

  return (
    <>
      <DialogTitle>Linking Session Details</DialogTitle>
      <p>
        Copy this session token and paste it into the web page you are trying to
        link with, or scan the QR Code below if your device has a camera.
      </p>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-1">
          <div className="flex-1 overflow-hidden rounded-md px-3 py-2 font-mono text-sm">
            <p className="truncate font-semibold">{linkDeviceToken}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(linkDeviceToken)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
        <div className="flex justify-center">
          <ErrorBoundary
            fallbackRender={(err) => (
              <SizableText color="destructive">
                Failed to generate QR code: {err.error.toString()}. It's
                probably a bug. Try using the token above.
              </SizableText>
            )}
          >
            <QRCode value={linkDeviceToken} size={400} />
          </ErrorBoundary>
        </div>
      </div>
    </>
  )
}

function DeviceLabelForm({
  onSuccess,
  accountUid,
  origin,
}: {
  onSuccess: (linkSession: DeviceLinkSession) => Promise<void>
  accountUid: string
  // Origin is provided when the label form is shown via the hm://device-link deep link,
  // to help the user pre-fill relevant label,
  // based on the web site domain they are coming from.
  origin?: string
}) {
  const linkDevice = useLinkDevice()

  const defaulLabel = useMemo(() => {
    if (origin) {
      // Origin without scheme for a more concise label.
      return origin.replace(/^https?:\/\//, '')
    }

    // Default label with some random suffix to distinguish them,
    // although the timestamp of the capability can be used for that as well.
    return `Web Device ${new Date().toLocaleDateString()}`
  }, [])

  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<{label: string}>({
    resolver: zodResolver(
      z.object({label: z.string().min(1, 'Device label is required')}),
    ),
    defaultValues: {
      label: defaulLabel,
    },
  })

  useEffect(() => {
    setFocus('label')
  }, [setFocus])

  if (linkDevice.isPending) {
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  }
  return (
    <form
      onSubmit={handleSubmit(async (data) => {
        const linkSession = await linkDevice.mutateAsync({
          label: data.label,
          accountUid,
        })
        onSuccess(linkSession)
      })}
    >
      <div className="flex flex-col gap-4">
        {linkDevice.error ? (
          <p className="text-destructive">
            Error linking device:{' '}
            {(linkDevice.error as any)?.message || 'Unknown error'}
          </p>
        ) : null}
        <div className="flex flex-col gap-1">
          <FormField name="label" label="Device Label" errors={errors}>
            <FormInput control={control} name="label" placeholder="My Device" />
          </FormField>
          <SizableText size="xs" className="text-muted-foreground">
            This label <em>cannot</em> be changed later. It's just for your
            convenience to distinguish linked sessions. E.g. you can use the
            name or the domain of the web site you are linking with.
          </SizableText>
        </div>

        <Button variant="inverse" type="submit" className="w-full">
          Start Linking Session
        </Button>
      </div>
    </form>
  )
}
