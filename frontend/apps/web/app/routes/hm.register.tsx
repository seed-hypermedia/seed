import {useLocalKeyPair, useLocalKeyPairLoaded} from '@/auth'
import {defaultPageMeta} from '@/meta'
import {useSearchParams} from '@remix-run/react'
import {Button} from '@shm/ui/button'
import {SizableText} from '@shm/ui/text'
import {useState} from 'react'

export const loader = async ({request}: {request: Request}) => {
  return null
}

export const meta = defaultPageMeta('Space Registration')

export default function RegisterPage() {
  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="flex flex-1 items-start justify-center px-4 py-12">
        <div className="border-border dark:bg-background flex w-full max-w-lg flex-1 flex-col gap-4 rounded-lg border bg-white p-6 shadow-lg">
          <SizableText size="5xl">🚀</SizableText>
          <SizableText size="2xl" weight="bold">
            Secret Space Setup Link
          </SizableText>

          <SizableText asChild>
            <p>
              <b>Your Seed Hypermedia Space is Ready to be Deployed!</b>
            </p>
          </SizableText>
          <SizableText asChild>
            <p>
              From your publication or account page within the Seed Hypermedia app, click the dropdown in the top right
              corner and select "Publish Space". Then, paste the URL of this page into the dialog box, and click
              Publish!
            </p>
          </SizableText>
          <SizableText asChild>
            <p>
              Then your content will be published to this space. Your account will be registered in this domain, so all
              future content in your publication will be sent here and published to the web.
            </p>
          </SizableText>
          <SizableText asChild>
            <p>
              <b>Warning:</b> You should keep this URL a secret, otherwise somebody else might publish their content
              here before you do.
            </p>
          </SizableText>
          <BrowserRegistration />
        </div>
      </div>
    </div>
  )
}

type RegistrationState = {status: 'idle'} | {status: 'busy'} | {status: 'done'} | {status: 'error'; message: string}

/**
 * Web-only organizations have no desktop app: the space they created with
 * /hm/create-site already lives on this site's daemon, so registering it is
 * just the signed-in account claiming the setup secret here.
 */
function BrowserRegistration() {
  const [searchParams] = useSearchParams()
  const registrationSecret = searchParams.get('secret')
  const keyPair = useLocalKeyPair()
  const keyPairLoaded = useLocalKeyPairLoaded()
  const accountUid = keyPair?.delegatedAccountUid ?? keyPair?.id ?? null
  const [state, setState] = useState<RegistrationState>({status: 'idle'})

  if (!registrationSecret || !keyPairLoaded || !accountUid) return null

  async function register() {
    setState({status: 'busy'})
    try {
      const configResponse = await fetch('/hm/api/config', {credentials: 'include'})
      if (!configResponse.ok) throw new Error(`Could not read site config (${configResponse.status})`)
      const config = (await configResponse.json()) as {peerId?: string}
      if (!config.peerId) throw new Error('Site config is missing its peer ID')
      // Passing the site's own peer tells the register action the space is
      // already on this daemon, so it skips the libp2p connection step.
      const response = await fetch('/hm/api/register', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({registrationSecret, accountUid, peerId: config.peerId, addrs: []}),
      })
      const result = (await response.json().catch(() => ({}))) as {message?: string}
      if (!response.ok) throw new Error(result.message || `Registration failed (${response.status})`)
      setState({status: 'done'})
    } catch (e) {
      setState({status: 'error', message: e instanceof Error ? e.message : String(e)})
    }
  }

  return (
    <div className="border-border flex flex-col gap-3 border-t pt-4">
      <SizableText asChild>
        <p>
          <b>Already created your space here?</b> You are signed in, so you can register it directly from this browser.
        </p>
      </SizableText>
      {state.status === 'done' ? (
        <SizableText color="success">This space is now registered on this site.</SizableText>
      ) : (
        <Button onClick={register} loading={state.status === 'busy'} disabled={state.status === 'busy'}>
          Register this space on this site
        </Button>
      )}
      {state.status === 'error' ? (
        <SizableText color="destructive" size="sm">
          {state.message}
        </SizableText>
      ) : null}
    </div>
  )
}
