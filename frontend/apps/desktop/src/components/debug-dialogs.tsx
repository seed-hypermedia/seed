import {useState} from 'react'
import {Button} from '@shm/ui/button'
import {hmId, UnpackedHypermediaId} from '@shm/shared'
import {
  usePublishSite,
  useSeedHostDialog,
  useRemoveSiteDialog,
} from './publish-site'
import {useTemplateDialog} from './site-template'
import {dispatchOnboardingDialog} from './onboarding'
import {IS_PROD_DESKTOP} from '@shm/shared/constants'

// Mock data for testing - create proper UnpackedHypermediaId
// Using a valid-looking UID that matches the expected format
const MOCK_UID = 'z6MkhaXgBZDvotDkL5LzPvGhp5XAydZBz7LjJCRDmbo4bBgH'
const MOCK_DOCUMENT_ID: UnpackedHypermediaId = hmId(MOCK_UID)

const MOCK_DOCUMENT_ROUTE = {
  key: 'document' as const,
  id: MOCK_DOCUMENT_ID,
}

export function DebugDialogs() {
  const [showDebug, setShowDebug] = useState(!IS_PROD_DESKTOP)
  const publishSiteDialog = usePublishSite()
  const seedHostDialog = useSeedHostDialog()
  const removeSiteDialog = useRemoveSiteDialog()
  const templateDialogContent = useTemplateDialog(MOCK_DOCUMENT_ROUTE)

  // Don't show in production unless explicitly enabled
  if (!showDebug) {
    return IS_PROD_DESKTOP ? null : (
      <div className="fixed right-4 bottom-20 z-50">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowDebug(true)}
          className="opacity-30 hover:opacity-100"
        >
          Debug Dialogs
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="bg-background/95 fixed right-4 bottom-20 z-50 flex max-w-xs flex-col gap-2 rounded-lg border p-4 shadow-lg backdrop-blur">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-muted-foreground text-sm font-bold">
            Debug Dialogs
          </span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setShowDebug(false)}
            className="h-6 w-6 p-0"
          >
            ×
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs tracking-wider uppercase">
            Publish Dialogs
          </span>

          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              publishSiteDialog.open({
                id: MOCK_DOCUMENT_ID,
              })
            }
          >
            Publish Site (Main)
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              publishSiteDialog.open({
                id: MOCK_DOCUMENT_ID,
                step: 'seed-host-custom-domain',
              })
            }
          >
            Publish Site (Custom Domain)
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              console.log('Opening Seed Host Dialog with:', {
                id: MOCK_DOCUMENT_ID,
                host: 'example.hyper.media',
              })
              seedHostDialog.open({
                id: MOCK_DOCUMENT_ID,
                host: 'example.hyper.media',
              })
            }}
          >
            Seed Host Published
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => removeSiteDialog.open(MOCK_DOCUMENT_ID)}
          >
            Remove Site
          </Button>
        </div>

        <div className="mt-2 flex flex-col gap-1">
          <span className="text-muted-foreground text-xs tracking-wider uppercase">
            Onboarding
          </span>

          <Button
            size="sm"
            variant="outline"
            onClick={() => dispatchOnboardingDialog(true)}
          >
            Onboarding Dialog
          </Button>
        </div>

        <div className="mt-2 flex flex-col gap-1">
          <span className="text-muted-foreground text-xs tracking-wider uppercase">
            Test Specific Views
          </span>

          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              // Test the dark background seed host container
              publishSiteDialog.open({
                id: MOCK_DOCUMENT_ID,
              })
              console.log('Testing dark background container')
            }}
          >
            Test Dark BG (Seed Host)
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              console.log('Opening congrats dialog')
              seedHostDialog.open({
                id: MOCK_DOCUMENT_ID,
                host: 'mysite.hyper.media',
              })
            }}
          >
            Test Congrats Screen
          </Button>
        </div>

        <div className="text-muted-foreground mt-2 text-xs">
          <div>Platform: {window.navigator.platform}</div>
          <div>
            Dark Mode:{' '}
            {document.documentElement.classList.contains('dark') ? 'Yes' : 'No'}
          </div>
        </div>
      </div>

      {/* Render dialog contents */}
      {publishSiteDialog.content}
      {seedHostDialog.content}
      {removeSiteDialog.content}
      {templateDialogContent}
    </>
  )
}

// Additional debug component for testing specific dialog states
export function DebugPublishStates() {
  const publishDialog = usePublishSite()
  const [currentMode, setCurrentMode] = useState<string>('none')

  const modes = [
    {label: 'Initial Selection', value: 'initial'},
    {label: 'Self Host', value: 'self-host'},
    {label: 'Seed Host', value: 'seed-host'},
    {label: 'Input URL', value: 'input-url'},
    {label: 'Custom Domain', value: 'seed-host-custom-domain'},
  ]

  if (IS_PROD_DESKTOP) return null

  return (
    <div className="bg-background/95 fixed top-20 right-4 z-50 rounded-lg border p-4 shadow-lg backdrop-blur">
      <div className="mb-2 text-sm font-bold">Test Publish States</div>
      <div className="flex flex-col gap-1">
        {modes.map((mode) => (
          <Button
            key={mode.value}
            size="sm"
            variant={currentMode === mode.value ? 'default' : 'outline'}
            onClick={() => {
              setCurrentMode(mode.value)
              if (mode.value === 'initial') {
                publishDialog.open({id: MOCK_DOCUMENT_ID})
              } else if (mode.value === 'seed-host-custom-domain') {
                publishDialog.open({
                  id: MOCK_DOCUMENT_ID,
                  step: 'seed-host-custom-domain',
                })
              } else {
                // For other modes, we'd need to modify the dialog to accept initial mode
                publishDialog.open({id: MOCK_DOCUMENT_ID})
                console.log(`Would open in ${mode.value} mode if supported`)
              }
            }}
          >
            {mode.label}
          </Button>
        ))}
      </div>
      {publishDialog.content}
    </div>
  )
}
