import {ArrowLeft} from 'lucide-react'
import * as React from 'react'
import {Button} from './button'
import {DialogDescription, DialogTitle} from './components/dialog'
import {SeedLogo} from './seed-logo'

export type CreateAccountDialogSubmit = {type: 'register'} | {type: 'login'} | {type: 'custom-id-server'; url: string}

type CreateAccountDialogContentProps = {
  localAccountUnlocked?: boolean
  title: string
  localAccountTitle: string
  localAccountDescription: string
  introDescription?: string
  createIdentityLabel?: string
  existingIdentityLabel?: string
  customIdentityTitle?: string
  defaultCustomIdentityUrl?: string
  customIdentityPlaceholder?: string
  localAccountForm?: React.ReactNode
  onTitleClick?: () => void
  onSubmit: (input: CreateAccountDialogSubmit) => void
}

/** Shared visual content for the create account / sign-in dialog. */
export function CreateAccountDialogContent({
  localAccountUnlocked = false,
  title,
  localAccountTitle,
  localAccountDescription,
  introDescription = 'Sign in or create your identity to get started.',
  createIdentityLabel = 'Create Identity on Hypermedia',
  existingIdentityLabel = 'Already have a Hypermedia Identity?',
  customIdentityTitle = 'Identity Domain',
  defaultCustomIdentityUrl = '',
  customIdentityPlaceholder,
  localAccountForm,
  onTitleClick,
  onSubmit,
}: CreateAccountDialogContentProps) {
  const [step, setStep] = React.useState<'main' | 'custom-identity'>('main')
  const [customIdentityUrl, setCustomIdentityUrl] = React.useState(defaultCustomIdentityUrl)

  if (!localAccountUnlocked && step === 'custom-identity') {
    return (
      <>
        <DialogTitle className="flex items-center gap-2 max-sm:text-base">{customIdentityTitle}</DialogTitle>
        <DialogDescription className="max-sm:text-sm">Enter the URL of your identity server.</DialogDescription>
        <input
          className="rounded border px-3 py-2 text-sm dark:bg-neutral-900"
          value={customIdentityUrl}
          onChange={(e) => setCustomIdentityUrl(e.target.value)}
          placeholder={customIdentityPlaceholder}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customIdentityUrl.trim()) {
              onSubmit({type: 'custom-id-server', url: customIdentityUrl.trim()})
            }
          }}
        />
        <div className="flex gap-2">
          <Button variant="ghost" size="lg" className="flex-1" onClick={() => setStep('main')}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <Button
            variant="default"
            size="lg"
            className="flex-1"
            disabled={!customIdentityUrl.trim()}
            onClick={() => onSubmit({type: 'custom-id-server', url: customIdentityUrl.trim()})}
          >
            Connect
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <DialogTitle className="flex items-center gap-2 max-sm:text-base" onClick={onTitleClick}>
        {localAccountUnlocked ? (
          localAccountTitle
        ) : (
          <>
            <div className="flex size-8 items-center justify-center rounded-full bg-emerald-600">
              <SeedLogo className="size-4 text-white" />
            </div>
            {title}
          </>
        )}
      </DialogTitle>

      {localAccountUnlocked ? (
        <>
          <DialogDescription className="max-sm:text-sm">{localAccountDescription}</DialogDescription>
          {localAccountForm}
        </>
      ) : (
        <>
          <DialogDescription className="max-sm:text-sm">{introDescription}</DialogDescription>

          <Button
            variant="default"
            type="submit"
            size="lg"
            className="w-full"
            onClick={() => onSubmit({type: 'register'})}
          >
            {createIdentityLabel}
          </Button>

          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            <span className="text-xs text-neutral-400 dark:text-neutral-500">Or,</span>
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
          </div>

          <Button variant="outline" size="lg" className="w-full" onClick={() => onSubmit({type: 'login'})}>
            {existingIdentityLabel}
          </Button>

          <div className="text-center text-sm">
            <button
              type="button"
              className="cursor-pointer font-medium text-neutral-500 hover:underline dark:text-neutral-400"
              onClick={() => setStep('custom-identity')}
            >
              I have a different identity domain
            </button>
          </div>
        </>
      )}
    </>
  )
}
