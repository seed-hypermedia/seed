import {useCreateAccount, useLocalKeyPair} from '@/auth'
import {ClientOnly} from '@/client-lazy'
import {getMetadata, getOriginRequestData} from '@/loaders'
import {defaultSiteIcon} from '@/meta'
import {injectModels} from '@/models'
import {PageFooter} from '@/page-footer'
import {getOptimizedImageUrl, WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config.server'
import {unwrap} from '@/wrapping'
import {wrapJSON} from '@/wrapping.server'
import * as cbor from '@ipld/dag-cbor'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {MetaDescriptor, useLoaderData} from '@remix-run/react'
import {
  DeviceLinkSessionSchema,
  hmId,
  useRouteLink,
  useUniversalAppContext,
} from '@shm/shared'
import {
  DeviceLinkSession,
  HMMetadata,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useAccount} from '@shm/shared/models/entity'
import {queryKeys} from '@shm/shared/models/query-keys'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {HMIcon} from '@shm/ui/hm-icon'
import {Close} from '@shm/ui/icons'
import {SmallSiteHeader} from '@shm/ui/site-header'
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {Scanner, type IDetectedBarcode} from '@yudiel/react-qr-scanner'
import {
  ArrowRight,
  Check,
  KeySquare,
  Link as LinkIcon,
  Monitor,
  Smartphone,
} from 'lucide-react'
import {base58btc} from 'multiformats/bases/base58'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import {postCBOR} from '../api'
import {LocalWebIdentity} from '../auth'
import {linkDevice, LinkingEvent, LinkingResult} from '../device-linking'
import type {DelegateDevicePayload} from './hm.api.delegate-device'
import {Spinner} from '@shm/ui/spinner'

injectModels()

type DeviceLinkPagePayload = {
  enableWebSigning: boolean
  originHomeId: UnpackedHypermediaId | undefined
  originHomeMetadata: HMMetadata | undefined
  origin: string
} & ReturnType<typeof getOriginRequestData>

export const meta: MetaFunction = ({data}) => {
  const {originHomeMetadata} = unwrap<DeviceLinkPagePayload>(data)
  const meta: MetaDescriptor[] = []
  const homeIcon = originHomeMetadata?.icon
    ? getOptimizedImageUrl(extractIpfsUrlCid(originHomeMetadata.icon), 'S')
    : null
  meta.push({
    tagName: 'link',
    rel: 'icon',
    href: homeIcon || defaultSiteIcon,
    type: 'image/png',
  })
  meta.push({
    title: 'Link Seed Hypermedia Device',
  })
  return meta
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const config = await getConfig(parsedRequest.hostname)

  const originHome = config?.registeredAccountUid
    ? await getMetadata(hmId(config.registeredAccountUid))
    : undefined
  return wrapJSON({
    originHomeId: config?.registeredAccountUid
      ? hmId(config.registeredAccountUid)
      : undefined,
    ...getOriginRequestData(parsedRequest),
    originHomeMetadata: originHome?.metadata ?? undefined,
  } satisfies DeviceLinkPagePayload)
}

export default function DeviceLinkPage() {
  const {originHomeId, siteHost, origin, originHomeMetadata} =
    unwrap<DeviceLinkPagePayload>(useLoaderData())
  if (!originHomeId) {
    return <h2>Invalid origin home id</h2>
  }
  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={originHomeId}
      siteHost={siteHost}
    >
      <div className="flex h-dvh flex-col">
        {originHomeMetadata && (
          <SmallSiteHeader
            originHomeMetadata={originHomeMetadata}
            originHomeId={originHomeId}
            siteHost={siteHost}
          />
        )}
        <div className="flex flex-1 justify-center bg-gray-50">
          <ClientOnly>
            <HMDeviceLink />
          </ClientOnly>
        </div>
        <PageFooter hideDeviceLinkToast={true} />
      </div>
    </WebSiteProvider>
  )
}

export function HMDeviceLink() {
  const [hash, setHash] = useURLHash()
  const keyPair = useLocalKeyPair()
  const myAccount = useAccount(keyPair?.id)
  const needKey = !keyPair

  // Parse session from hash if present
  const {session, parseError} = useMemo(() => {
    if (!hash) {
      return {session: null, parseError: false}
    }
    try {
      const parsed = DeviceLinkSessionSchema.parse(
        cborDecode(base58btc.decode(hash)),
      )
      return {session: parsed, parseError: false}
    } catch (e) {
      console.error('Failed to parse device link session from hash:', e)
      return {session: null, parseError: true}
    }
  }, [hash])

  // TODO(burdiyan): this is not the most robust way to check if the key is linked.
  // We ask the server for the profile info of the current key ID, and if it returns a profile with a different ID,
  // we assume this key is already linked to this profile. We trust the server to follow the identity redirects.
  const isAlreadyLinked = Boolean(
    keyPair &&
      myAccount &&
      myAccount.data &&
      keyPair.id !== myAccount.data.id.uid,
  )

  return (
    <div className="my-auto w-full max-w-2xl space-y-4 rounded-xl bg-white p-8 shadow">
      {needKey ? (
        <KeyPairRequiredView />
      ) : !myAccount.data ? (
        <div className="flex items-center justify-center">
          <Spinner />
        </div>
      ) : parseError ? (
        <InvalidTokenView onBack={() => setHash('')} />
      ) : isAlreadyLinked ? (
        <CompletionView accountInfo={myAccount.data} />
      ) : session ? (
        <ConfirmationView keyPair={keyPair} session={session} />
      ) : (
        <LinkingInstructionsView accountInfo={myAccount.data} />
      )}
    </div>
  )
}

/**
 * View shown when the token in the URL hash is invalid.
 */
function InvalidTokenView({onBack}: {onBack: () => void}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <Close className="h-8 w-8 text-red-600" />
        </div>
        <h1 className="text-2xl font-semibold">Invalid Session Token</h1>
        <p className="text-sm text-gray-600">
          The session token in the URL is invalid or malformed. Please check
          that you copied the entire token correctly, or scan the QR code again.
        </p>
      </div>
      <Button variant="default" onClick={onBack} className="w-full">
        Try Again
      </Button>
    </div>
  )
}

/**
 * This view is displayed when the user visits the device linking page,
 * but doesn't have a key pair yet. Here they'll be able to create one.
 */
function KeyPairRequiredView() {
  const createAccount = useCreateAccount()

  return (
    <>
      {/* Header */}
      <div className="flex flex-col space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Create your web identity</h1>
        <p className="text-sm text-gray-600">
          You don't have a key pair on this web site yet. Please create one
          first to continue.
        </p>
      </div>

      <div className="flex flex-col items-center space-y-4">
        <Button variant="default" onClick={() => createAccount.createAccount()}>
          Create Account
        </Button>
        {createAccount.content}
      </div>
    </>
  )
}

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  )
}

/**
 * This is the main view with device linking instructions and buttons.
 */
function LinkingInstructionsView({
  accountInfo,
}: {
  // This type definition is a bit ugly, because useAccount doesn't seem to return a named type.
  // And in this component we don't care about falsy values.
  accountInfo: Exclude<ReturnType<typeof useAccount>['data'], null | undefined>
}) {
  const [showCamera, setShowCamera] = useState(false)
  const [showDesktopAppLinking, setShowDesktopAppLinking] = useState(false)
  const isMobile = isMobileDevice()

  const desktopAppDeepLink = `hm://device-link?origin=${window.location.origin}`

  if (showCamera) {
    return <QRCodeScanner onClose={() => setShowCamera(false)} />
  }

  if (showDesktopAppLinking) {
    return (
      <DesktopAppLinkingView onBack={() => setShowDesktopAppLinking(false)} />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col items-center justify-center gap-4">
        <h1 className="text-center text-2xl font-semibold">
          Link this browser to your identity
        </h1>
        <div className="flex flex-row items-center justify-center gap-2">
          <span className="text-sm font-medium text-gray-700">
            Current profile:
          </span>
          <HMIcon id={accountInfo.id} icon={accountInfo.metadata?.icon} />
          <span className="text-sm">
            {accountInfo.metadata?.name || accountInfo.id.uid}
          </span>
        </div>
      </div>

      {/* Instructions */}
      <div className="flex flex-col gap-4 text-gray-800">
        <p>
          You need a computer with the Seed desktop app installed. You can
          download the app from{' '}
          <a
            href="https://seed.hyper.media"
            target="_blank"
            className="text-primary underline-offset-4 hover:underline"
          >
            seed.hyper.media
          </a>{' '}
          if you don't have it.
        </p>

        {/* On mobile devices we know for sure they don't have a desktop app on the same device,
          so we just hide these instructions. */}
        {!isMobile && (
          <div className="flex flex-col gap-3">
            <p className="font-medium text-gray-900">
              If you're on the same device where the app is installed, just
              click this button:
            </p>

            <Button variant="default" className="w-full" asChild>
              <a
                href={desktopAppDeepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block w-full"
                onClick={() => setShowDesktopAppLinking(true)}
              >
                <Monitor /> Open Desktop App
              </a>
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <p className="font-medium text-gray-900">
            {isMobile
              ? 'Follow these steps:'
              : "If you're on a different device, follow these steps:"}
          </p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>Open the Seed desktop app on your computer.</li>
            <li>
              Choose the account you want to link with in the account picker in
              the sidebar, then click on the key icon [
              {<KeySquare className="inline-block size-4 align-text-bottom" />}]
              next to the account name. Follow the instructions to start a
              linking session.
            </li>
            <li>
              Use one of the options below to connect this browser to your
              desktop app.
            </li>
          </ol>
        </div>
      </div>

      <div className="flex flex-col items-stretch gap-1">
        <ScanQRCodeCard onClick={() => setShowCamera(true)} />
        <p className="flex-grow-0 text-center text-gray-500">or</p>
        <CopyPasteSessionCard />
      </div>
    </div>
  )
}

/**
 * This view is displayed when the user clicks the Open Desktop App button
 * to clean up the page and only show the relevant form.
 */
function DesktopAppLinkingView({onBack}: {onBack: () => void}) {
  // This effect handles the browser's back button behavior,
  // to drive the user to the linking instructions view,
  // instead of navigating to the previous page.
  // The entire interaction here doesn't have any proper routing,
  // so this is just a quick workaround.
  useEffect(() => {
    // Push a dummy state to history when this screen mounts.
    window.history.pushState({custom: true}, '')

    const handlePopState = (event: any) => {
      if (event.state && event.state.custom) {
        // User pressed the browser back button.
        // Calling the same back handler.
        onBack()
      }
    }

    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [onBack])

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="relative flex flex-col items-center justify-center gap-4">
        {/* Back button */}
        <button
          type="button"
          className="absolute top-0 left-0 flex h-8 w-8 items-center justify-center rounded-full border text-gray-700 hover:bg-gray-100 focus:ring-2 focus:ring-gray-300 focus:outline-none"
          aria-label="Go back"
          onClick={onBack}
        >
          <ArrowRight className="h-4 w-4 rotate-180" />
        </button>
        <h1 className="text-center text-2xl font-semibold">
          Complete linking in desktop app
        </h1>
      </div>

      {/* Instructions */}
      <div className="flex flex-col gap-2 text-gray-800">
        <p>
          Follow the instructions in the Seed desktop app to start the linking
          process, then copy the session token and paste it in the form below.
        </p>

        <p className="text-sm text-gray-600">
          If you didn't follow through with the process, you can start over by
          pressing the back button.
        </p>
      </div>

      <CopyPasteSessionCard hideDescription={true} />
    </div>
  )
}

function ScanQRCodeCard({onClick}: {onClick: () => void}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-4">
      <Smartphone className="mt-1 h-6 w-6 text-gray-500" />
      <div className="flex flex-1 flex-col gap-3">
        <div>
          <h2 className="font-medium">Scan QR Code</h2>
          <p className="text-sm text-gray-600">
            If your device has a camera, you can scan the QR code shown in the
            desktop app.
          </p>
        </div>
        <Button variant="inverse" onClick={onClick} className="w-full">
          Scan QR Code
        </Button>
      </div>
    </div>
  )
}

function CopyPasteSessionCard({
  hideDescription = false,
}: {
  hideDescription?: boolean
}) {
  const [token, setToken] = useState('')
  const [hash, setHash] = useURLHash()

  return (
    <div className="flex items-start gap-3 rounded-lg border p-4">
      <LinkIcon className="mt-1 h-6 w-6 text-gray-500" />
      <div className="flex flex-1 flex-col gap-3">
        <div>
          <h2 className="font-medium">Copy-Paste Session Token</h2>
          {!hideDescription && (
            <p className="text-sm text-gray-600">
              If your device doesn't have a camera, or you have problems
              scanning the QR code — paste the session token here manually. You
              can email it to yourself, or transfer it by any means you prefer.
            </p>
          )}
        </div>
        <form
          className="flex"
          onSubmit={(e) => {
            e.preventDefault()
            setHash(token.trim())
          }}
        >
          <Input
            type="text"
            placeholder="Paste token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="flex-1 rounded-l-lg rounded-r-none border border-gray-300 px-3 py-2 text-base focus:outline-none"
          />
          <Button
            variant="default"
            className="rounded-l-none"
            type="submit"
            disabled={!token.trim()}
          >
            Link
          </Button>
        </form>
      </div>
    </div>
  )
}

/**
 * Custom QR code scanner component to support the close button overlay.
 * The upstream library seems to have a bug which doesn't respect the children components when finder overlay is enabled.
 * It also handles the parsing of QR codes and updating the URL hash.
 */
function QRCodeScanner({onClose}: {onClose: () => void}) {
  const [_, setHash] = useURLHash()

  function parseQRCode(data: IDetectedBarcode[]) {
    if (data.length > 0 && data[0]?.rawValue) {
      const scannedToken = data[0].rawValue
      setHash(scannedToken)
    }
  }

  return (
    <Scanner
      components={{torch: false, finder: false}}
      sound={false}
      onScan={parseQRCode}
    >
      <div className="relative flex min-h-full flex-col items-center justify-center">
        <button
          type="button"
          className="absolute top-2 left-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-700 shadow-md hover:bg-gray-100 focus:ring-2 focus:ring-gray-300 focus:outline-none"
          aria-label="Close"
          onClick={onClose}
        >
          <Close />
        </button>

        {/* Overlay with the viewfinder frame. */}
        <div
          style={{
            position: 'relative',
            width: '70%',
            aspectRatio: '1 / 1',
            border: '3px dashed rgba(230, 68, 68, 0.9)',
            borderRadius: '0.5rem',
          }}
        ></div>
      </div>
    </Scanner>
  )
}

function DeviceLinkStatus({currentState}: {currentState: LinkingState}) {
  if (currentState.state === 'error') {
    return <p>Libp2p Error: {currentState.error}</p>
  }

  if (currentState.state === 'event') {
    const event = currentState.event
    switch (event.type) {
      case 'dialing':
        return <p>Dialing {event.addr}...</p>
      case 'dial-ok':
        return <p>Dialed {event.addr} successfully</p>
    }
  }

  return null
}

/**
 * View shown when user needs to approve device linking.
 */
function ConfirmationView({
  keyPair,
  session,
}: {
  keyPair: LocalWebIdentity
  session: DeviceLinkSession
}) {
  const [completion, setCompletion] = useState<Completion | null>(null)
  const [hash, setHash] = useURLHash()

  const browserAccount = useAccount(keyPair.id)
  const desktopAccount = useAccount(session.accountId)

  // Always call useAccount unconditionally, even if completion is null.
  const completionAccount = useAccount(completion?.appAccountId || null)

  const linkDevice = useLinkDevice(keyPair)

  if (completion && completionAccount.data) {
    return <CompletionView accountInfo={completionAccount.data} />
  }

  if (!browserAccount.data || !desktopAccount.data) {
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <h1 className="overflow-wrap-anywhere text-2xl font-semibold break-words">
        Confirm Key Linking
      </h1>
      <p className="overflow-visible text-sm text-wrap break-all text-gray-600">
        After confirming, the current profile will become linked with the target
        profile.
      </p>
      <div className="flex w-full flex-col justify-center gap-4 sm:flex-row">
        <ProfileCard title="Current profile" account={browserAccount.data} />
        <ProfileCard title="Target profile" account={desktopAccount.data} />
      </div>

      <div className="flex w-full flex-row items-center justify-center truncate text-center text-wrap wrap-anywhere break-all text-gray-600">
        <DeviceLinkStatus currentState={linkDevice.state} />
      </div>

      <div className="flex w-full flex-col gap-3">
        <Button
          onClick={() => {
            linkDevice.mutation.mutateAsync(session).then((result) => {
              setCompletion({
                browserAccountId: result.browserAccountId,
                appAccountId: result.appAccountId,
              })
            })
          }}
          disabled={linkDevice.mutation.isPending}
          variant="default"
          className="w-full"
        >
          Confirm
          <Check
            className="absolute ml-1 h-4 w-4"
            style={{left: 'calc(50% + 2rem)'}}
          />
        </Button>
        <Button
          variant="outline"
          onClick={() => setHash('')}
          disabled={linkDevice.mutation.isPending}
          className="w-full"
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * View shown when device is successfully linked.
 */
function CompletionView({
  accountInfo,
}: {
  accountInfo: Exclude<ReturnType<typeof useAccount>['data'], null | undefined>
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <Check className="h-8 w-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-semibold">Successfully Linked!</h1>
        <p className="text-sm text-gray-600">
          The signing key in this browser is already linked. From now on, you
          will be acting on behalf of this account:
        </p>
      </div>
      <div className="flex flex-col items-center gap-1 rounded-lg border bg-gray-50 p-6">
        <HMIcon
          id={accountInfo.id}
          icon={accountInfo.metadata?.icon}
          name={accountInfo.metadata?.name}
          size={64}
        />
        <div className="text-center">
          <p className="font-semibold">
            {accountInfo.metadata?.name || 'Unknown Account'}
          </p>
          <p className="truncate text-xs text-gray-500">{accountInfo.id.uid}</p>
        </div>
      </div>
      <p className="text-center text-sm text-gray-600">
        You can close this window now or click the button below to go back to
        the home page.
      </p>
      <GoHomeButton />
    </div>
  )
}

function ProfileCard({
  title,
  account,
}: {
  title: string
  account: {
    id: UnpackedHypermediaId
    metadata?: HMMetadata | null
  }
}) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 text-xs font-medium tracking-wide text-gray-800 uppercase">
        {title}
      </div>
      <div className="flex items-center gap-3">
        <HMIcon
          id={account.id}
          icon={account.metadata?.icon}
          name={account.metadata?.name}
          size={40}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-gray-900">
            {account.metadata?.name || 'Unnamed Profile'}
          </div>
          <div className="truncate font-mono text-sm text-gray-500">
            {account.id.uid}
          </div>
        </div>
      </div>
    </div>
  )
}

function GoHomeButton() {
  const {originHomeId} = useUniversalAppContext()
  const routeLink = useRouteLink(
    originHomeId
      ? {
          key: 'document',
          id: originHomeId,
        }
      : null,
    {
      handler: 'onClick',
    },
  )
  if (!originHomeId) {
    return null
  }
  return (
    <Button {...routeLink} size="sm" variant="default">
      Go Home
      <ArrowRight className="size-4" />
    </Button>
  )
}

async function storeDeviceDelegation(payload: DelegateDevicePayload) {
  const result = await postCBOR('/hm/api/delegate-device', cbor.encode(payload))
  console.log('delegateDevice result', result)
}

type LinkingState =
  | {state: 'idle'}
  | {
      state: 'result'
      result: LinkingResult
    }
  | {
      state: 'event'
      event: LinkingEvent
    }
  | {
      state: 'error'
      error: string
    }

/**
 * Hook to trigger the device syncing logic via libp2p.
 * It returns a tuple of the current linking state and the function to actually trigger the process.
 */
function useLinkDevice(localIdentity: LocalWebIdentity) {
  const [linkingState, setLinkingState] = useState<LinkingState>({
    state: 'idle',
  })
  const queryClient = useQueryClient()
  return {
    state: linkingState,
    mutation: useMutation({
      mutationFn: async (session: DeviceLinkSession) => {
        const result = await linkDevice(
          session,
          localIdentity,
          (e: LinkingEvent) => {
            setLinkingState({
              state: 'event',
              event: e,
            })
          },
        )
        setLinkingState({
          state: 'result',
          result: result,
        })

        console.log('Device linking successful')
        console.log('App capability:', result.appToBrowserCap)
        console.log('Browser capability:', result.browserToAppCap)
        console.log('Profile alias:', result.profileAlias)

        await storeDeviceDelegation({
          profileAlias: result.profileAlias.raw,
          browserToAppCap: result.browserToAppCap.raw,
          appToBrowserCap: result.appToBrowserCap.raw,
        })
        return result
      },
      onError: (error) => {
        setLinkingState({
          state: 'error',
          error: (error as Error).message,
        })
      },
      onSuccess: (data) => {
        queryClient.invalidateQueries({
          queryKey: [queryKeys.ACCOUNT],
        })
      },
    }),
  }
}

type Completion = {
  browserAccountId: string
  appAccountId: string
}

/**
 * This hook works like useState but also syncs the value into the URL hash.
 */
function useURLHash() {
  const subscribe = useCallback((callback: () => void) => {
    window.addEventListener('hashchange', callback)
    return () => window.removeEventListener('hashchange', callback)
  }, [])

  const getSnapshot = () => window.location.hash.slice(1)

  const getServerSnapshot = () => ''

  const hash = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const setHash = useCallback((value: string) => {
    if (value === '' || value === '#') {
      history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      )
      // Firing the event manually to trigger the re-render,
      // because replacing the state does not trigger the event.
      // We don't simply set the value, because setting an empty string
      // into window.location.hash leaves a trailing # in the browser's address bar which is ugly.
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    } else {
      window.location.hash = value
    }
  }, [])

  return [hash, setHash] as const
}
