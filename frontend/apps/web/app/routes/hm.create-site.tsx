import {logout, redirectToVaultSignIn, SPACE_EXISTS_BODY, SPACE_EXISTS_TITLE, useLocalKeyPair} from '@/auth'
import {createSpaceHomeDraft} from '@/document-edit/web-create-space-draft'
import {makeWebFileUpload} from '@/document-edit/web-image-upload'
import {webUniversalClient} from '@/universal-client'
import {useHasExistingSpace} from '@/web-create-space-dialog'
import {useNavigate} from '@remix-run/react'
import {WEB_IDENTITY_ORIGIN} from '@shm/shared/constants'
import {Button} from '@shm/ui/button'
import {CreateSpaceForm, type CreateSpaceFormState} from '@shm/ui/create-space-form'
import {createSpaceMetadata} from '@shm/ui/create-space-platform'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useEffect, useMemo, useState} from 'react'

/**
 * Track the visual viewport height and size the panel to it for mobile form.
 */
function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const vv = window.visualViewport
    const update = () => setHeight(vv ? vv.height : window.innerHeight)
    update()
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  return height
}

function Panel({children}: {children: React.ReactNode}) {
  const viewportHeight = useVisualViewportHeight()
  return (
    <div
      className="flex w-full justify-end bg-black/5 dark:bg-black/30"
      style={viewportHeight ? {height: viewportHeight} : {height: '100dvh'}}
    >
      <div className="bg-background flex h-full w-full max-w-[440px] flex-col shadow-xl">{children}</div>
    </div>
  )
}

/**
 * "Create a space" entry point. The form writes a local home draft (anonymous
 * pending draft when signed out, or a real draft under the account when signed
 * in) and opens the editor; publishing that draft creates the space. Cover/logo
 * images are uploaded to IPFS here and referenced in the draft metadata.
 */
export default function CreateSiteRoute() {
  const navigate = useNavigate()
  const userKeyPair = useLocalKeyPair()
  const accountUid = userKeyPair?.delegatedAccountUid ?? userKeyPair?.id ?? null
  const [busy, setBusy] = useState(false)
  const fileUpload = useMemo(() => makeWebFileUpload(webUniversalClient), [])

  // When signed in, check whether this account already has a space.
  const existingSpace = useHasExistingSpace(accountUid, webUniversalClient)

  // Log out, then reopen the vault so the user can sign in
  // with a different identity and create a space there.
  async function switchAccount() {
    await logout()
    const origin = window.location.origin
    const vaultUrl = `${WEB_IDENTITY_ORIGIN || origin}/vault/delegate`
    await redirectToVaultSignIn({origin, vaultUrl})
  }

  async function handleComplete(state: CreateSpaceFormState) {
    setBusy(true)
    try {
      // Upload cover/logo to IPFS and reference the resulting CIDs
      // in the metadata, mirroring the web draft image flow.
      const [coverCid, logoCid, faviconCid] = await Promise.all([
        state.cover ? fileUpload(state.cover) : Promise.resolve(undefined),
        state.logo ? fileUpload(state.logo) : Promise.resolve(undefined),
        state.favicon ? fileUpload(state.favicon) : Promise.resolve(undefined),
      ])
      const metadata = createSpaceMetadata(state, {coverCid, logoCid, faviconCid})
      const {webPath} = await createSpaceHomeDraft(metadata, accountUid)
      navigate(webPath)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create space')
      setBusy(false)
    }
  }

  if (accountUid && existingSpace.isLoading) {
    return (
      <Panel>
        <div className="flex flex-1 items-center justify-center p-6">
          <Spinner />
        </div>
      </Panel>
    )
  }

  if (accountUid && existingSpace.data?.exists) {
    const existingSiteUrl = existingSpace.data.siteUrl
    return (
      <Panel>
        <div className="flex h-full flex-col p-6">
          <div className="flex flex-col gap-4">
            <SizableText size="2xl" weight="bold" asChild>
              <h2>{SPACE_EXISTS_TITLE}</h2>
            </SizableText>
            <SizableText className="text-muted-foreground">{SPACE_EXISTS_BODY}</SizableText>
          </div>
          <div className="mt-auto flex gap-2 pt-6">
            <Button variant="outline" size="lg" className="flex-1" onClick={() => void switchAccount()}>
              Use a different account
            </Button>
            <Button
              variant="default"
              size="lg"
              className="flex-1"
              onClick={() => {
                // Prefer the site's canonical custom domain. Fall back to the
                // gateway path only when the site has no custom domain.
                if (existingSiteUrl) window.location.href = existingSiteUrl
                else navigate(`/hm/${accountUid}`)
              }}
            >
              Go to your space
            </Button>
          </div>
        </div>
      </Panel>
    )
  }

  return (
    <Panel>
      <CreateSpaceForm onComplete={handleComplete} onClose={() => navigate('/')} />
      {busy ? <div className="fixed inset-0 z-50 cursor-progress" aria-hidden /> : null}
    </Panel>
  )
}
