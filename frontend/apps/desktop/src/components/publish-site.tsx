import {HostInfoResponse, useHostSession} from '@/models/host'
import {useRemoveSite, useSiteRegistration} from '@/models/site'
import {useNavigate} from '@/utils/useNavigate'
import {zodResolver} from '@hookform/resolvers/zod'
import {
  DocumentRoute,
  hmId,
  hostnameStripProtocol,
  useUniversalAppContext,
} from '@shm/shared'
import {SEED_HOST_URL, VERSION} from '@shm/shared/constants'
import {getDocumentTitle} from '@shm/shared/content'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {loadResource, useResource} from '@shm/shared/models/entity'
import {Button, ButtonProps} from '@shm/ui/button'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {FormInput} from '@shm/ui/form-input'
import {FormField} from '@shm/ui/forms'
import {
  IconComponent,
  PasteSetupUrl,
  SeedHost,
  SelfHost,
  UploadCloud,
} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {SizableText, Text, TextProps} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {
  AlertCircle,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  X,
} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {SubmitHandler, useForm} from 'react-hook-form'
import {ButtonText, Form, Theme, ThemeName, XGroup} from 'tamagui'
import {z} from 'zod'

import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@shm/ui/components/alert-dialog'
import {HoverCard, HoverCardContent, HoverCardTrigger} from '@shm/ui/hover-card'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {AlertTriangle, ArrowLeft, Plus} from 'lucide-react'
import {
  CelebrationDotsLeft,
  CelebrationDotsRight,
  CongratsGraphic,
  WebPublishedGraphic,
} from './publish-graphics'

export function usePublishSite() {
  return useAppDialog(PublishSiteDialog, {
    contentClassName:
      'max-w-3xl h-8/10 w-full p-0 flex items-center justify-center',
  })
}

export function useRemoveSiteDialog() {
  return useAppDialog(RemoveSiteDialog, {isAlert: true})
}

function RemoveSiteDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: UnpackedHypermediaId
}) {
  const removeSite = useRemoveSite(input)
  return (
    <div className="flex flex-col gap-4 rounded-lg p-4">
      <AlertDialogTitle>Remove Site</AlertDialogTitle>
      <AlertDialogDescription>
        Remove this site URL from the entity? Your site will still exist until
        you delete the server.
      </AlertDialogDescription>

      <div className="flex justify-end gap-3">
        <AlertDialogCancel asChild>
          <Button
            variant="ghost"
            onClick={() => {
              onClose()
            }}
          >
            Cancel
          </Button>
        </AlertDialogCancel>
        <AlertDialogAction asChild>
          <Button
            variant="destructive"
            onClick={() => {
              removeSite.mutate()
              onClose()
            }}
          >
            Remove Site
          </Button>
        </AlertDialogAction>
      </div>
    </div>
  )
}

const publishSiteSchema = z.object({
  url: z.string(),
})
type PublishSiteFields = z.infer<typeof publishSiteSchema>

function PublishDialogContainer({
  children,
  heading,
  backButton,
}: React.PropsWithChildren<{heading?: string; backButton?: React.ReactNode}>) {
  return (
    <div className="flex max-w-xl flex-col gap-6">
      {heading ? (
        <SizableText size="3xl" weight="bold" className="text-center">
          {heading}
        </SizableText>
      ) : null}
      {backButton ? (
        <div className="absolute top-4 left-4">{backButton}</div>
      ) : null}
      <div className="flex flex-col justify-center gap-2">{children}</div>
    </div>
  )
}

function SeedHostHeader() {
  return (
    <div className="mt-6 flex items-center gap-2">
      <SeedHost color="#ffffff" size={32} />
      <Text weight="bold" size="lg" className="text-muted-foreground">
        Hosting by Seed Hypermedia
      </Text>
    </div>
  )
}

function SeedHostContainer({
  children,
  heading,
  backButton,
  footer,
}: React.PropsWithChildren<{
  heading?: string
  backButton?: React.ReactNode
  footer?: React.ReactNode
}>) {
  return (
    <div className="relative flex h-full w-full flex-col items-center gap-4 bg-gray-900 p-4">
      <SeedHostHeader />
      {backButton ? (
        <div className="absolute top-4 left-4">{backButton}</div>
      ) : null}
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        {heading ? (
          <Text
            weight="bold"
            size="lg"
            className="text-muted-foreground text-center"
          >
            {heading}
          </Text>
        ) : null}
        {children}
      </div>
      {footer ? footer : null}
    </div>
  )
}

function SeedHostCongratsContainer({
  children,
  heading,
  graphic,
  footer,
}: React.PropsWithChildren<{
  heading?: string
  graphic?: React.ReactNode
  footer?: React.ReactNode
}>) {
  return (
    <Theme name="dark_blue">
      <div className="bg-background relative flex h-[80vh] max-h-[800px] w-[80vw] max-w-[1000px] flex-col items-center gap-4 p-4">
        <div className="absolute top-20 bottom-0 left-0 [transform-origin:center] scale-125 animate-[superSlow] [animation-delay:0ms] [animation-duration:3000ms] [animation-fill-mode:both] [animation-name:celebration-dots-left] [animation-timing-function:ease-in-out]">
          <CelebrationDotsLeft />
        </div>
        <div className="absolute top-20 right-0 bottom-0 [transform-origin:center] scale-125 animate-[superSlow] [animation-delay:0ms] [animation-duration:3000ms] [animation-fill-mode:both] [animation-name:celebration-dots-right] [animation-timing-function:ease-in-out]">
          <CelebrationDotsRight />
        </div>
        <SeedHostHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          {graphic ? (
            <div className="scale-100 [transform:translateY(0px)] animate-[bounce] opacity-100 [animation-delay:0ms] [animation-duration:1000ms] [animation-fill-mode:both]">
              {graphic}
            </div>
          ) : null}
          {heading ? (
            <Text
              weight="bold"
              size="lg"
              className="text-muted-foreground mb-4 text-center"
            >
              {heading}
            </Text>
          ) : null}
          {children}
        </div>
        {footer ? footer : null}
      </div>
    </Theme>
  )
}

function PublishSiteDialog({
  input,
  onClose,
}: {
  input: {
    id: UnpackedHypermediaId
    step?: 'seed-host-custom-domain' | undefined
  }
  onClose: () => void
}) {
  const {id, step: initialStep} = input
  const [mode, setMode] = useState<
    'input-url' | 'self-host' | 'seed-host' | 'seed-host-custom-domain' | null
  >(initialStep || null)
  if (mode === 'input-url') {
    return (
      <PublishWithUrl
        id={id}
        onComplete={onClose}
        onBack={() => setMode(null)}
      />
    )
  }
  if (mode === 'self-host') {
    return (
      <SelfHostContent
        onSetupUrl={() => setMode('input-url')}
        onBack={() => setMode(null)}
      />
    )
  }
  if (mode === 'seed-host') {
    return (
      <SeedHostContent onClose={onClose} onBack={() => setMode(null)} id={id} />
    )
  }
  if (mode === 'seed-host-custom-domain') {
    return <SeedHostRegisterCustomDomain id={id} onClose={onClose} />
  }
  return (
    <PublishDialogContainer heading="Set Up Web Domain">
      <DialogInner>
        <SizableText size="3xl" className="text-muted-foreground text-center">
          How would you like to publish to the web?
        </SizableText>
        <div className="bg-muted flex flex-col gap-2 rounded-lg p-2">
          <PublishOptionButton
            icon={SeedHost}
            onClick={() => setMode('seed-host')}
            label="Free Hosting by Seed Hypermedia"
            theme="blue"
            height={60}
          />
          <PublishOptionButton
            icon={SelfHost}
            onClick={() => setMode('self-host')}
            label="Self Host on Your Own Server"
          />
          <PublishOptionButton
            icon={PasteSetupUrl}
            onClick={() => setMode('input-url')}
            label="Paste a Hosting Setup URL"
          />
        </div>
      </DialogInner>
    </PublishDialogContainer>
  )
}

function DialogInner(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(props.className, 'flex max-w-md flex-col gap-2')}
    />
  )
}

function BlueButton(props: ButtonProps) {
  return <Button {...props} variant="blue" />
}

function GreenButton(props: ButtonProps) {
  return <Button {...props} variant="green" />
}

function PublishOptionButton({
  icon: Icon,
  onClick,
  label,
  color,
  height,
  theme,
}: {
  icon: IconComponent
  onClick: () => void
  label: string
  color?: string
  height?: number
  theme?: ThemeName
}) {
  return (
    <Button onClick={onClick} style={{height}}>
      <Icon color={color} size={32} />
      <SizableText className="text-muted-foreground" style={{color}}>
        {label}
      </SizableText>
    </Button>
  )
}

function BackButton({onPress}: {onPress: () => void}) {
  return (
    <Button size="icon" onClick={onPress} variant="ghost">
      <ArrowLeft className="size-4" />
    </Button>
  )
}

function SeedHostInfo({
  info,
  onSubmit,
}: {
  info: HostInfoResponse
  onSubmit: () => void
}) {
  if (!info.pricing?.free || !info.pricing?.premium) {
    return (
      <SizableText className="text-destructive">
        Error: Service unavailable or incompatible with this version of Seed.
      </SizableText>
    )
  }
  return (
    <div className="flex max-w-[600px] flex-col items-center justify-center gap-3">
      <SizableText className="text-muted-foreground text-center">
        Seed offers free server hosting with a generous storage and bandwidth
        limit, perfect for getting started. If your needs grow beyond the free
        tier, you can easily purchase additional capacity to scale seamlessly.
      </SizableText>
      <SizableText className="text-center text-blue-700">
        By using Seed, you're supporting{' '}
        <SizableText weight="bold" className="text-blue-700">
          Open Source Software
        </SizableText>
        , helping to build a more open and collaborative digital future.
      </SizableText>
      <div className="mt-4 flex justify-center gap-3">
        <PlanContainer>
          <PlanHeading>
            <PlanTitle>Free</PlanTitle>
            <PlanPrice value={0} />
          </PlanHeading>
          <PlanFeatures>
            <PlanFeature label={`${info.pricing.free.gbStorage} GB Storage`} />
            <PlanFeature
              label={`${info.pricing.free.gbBandwidth} GB Bandwidth`}
            />
            <PlanFeature label={siteCountLabel(info.pricing.free.siteCount)} />
          </PlanFeatures>
          <OverageWarning />
          <SelectPlanButton active onClick={onSubmit} />
        </PlanContainer>
        <PlanContainer>
          <PlanHeading>
            <PlanTitle>Premium</PlanTitle>
            <PlanPrice
              value={info.pricing.premium.monthlyPriceUSDCents}
              label="starting at"
            />
          </PlanHeading>
          <PlanFeatures>
            <PlanFeature
              label={`${info.pricing.premium.gbStorage} GB Storage`}
              plus={`${formatPriceUSDCents(
                info.pricing.premium.gbStorageOverageUSDCents,
              )}/GB/mo extra`}
            />
            <PlanFeature
              label={`${info.pricing.premium.gbBandwidth} GB Bandwidth`}
              plus={`${formatPriceUSDCents(
                info.pricing.premium.gbBandwidthOverageUSDCents,
              )}/GB extra`}
            />
            <PlanFeature
              label={siteCountLabel(info.pricing.premium.siteCount)}
              plus={`${formatPriceUSDCents(
                info.pricing.premium.siteCountOverageUSDCents,
              )}/mo extra site`}
            />
          </PlanFeatures>
          <SelectPlanButton comingSoon />
        </PlanContainer>
      </div>
      <div className="mb-4 flex justify-center rounded-lg border border-blue-700 p-3">
        <SizableText className="text-muted-foreground">
          For large organizations,{' '}
          <SizableText asChild className="text-muted-foreground underline">
            <a href="mailto:sales@seedhypermedia.com">contact us</a>
          </SizableText>{' '}
          for a customized plan.
        </SizableText>
      </div>
    </div>
  )
}

function SelectPlanButton({
  active,
  comingSoon,
  onClick,
}: {
  active?: boolean
  comingSoon?: boolean
  onClick?: () => void
}) {
  const label = active ? 'Get Started' : comingSoon ? 'Coming Soon' : 'Select'

  const disabled = !active || comingSoon
  return (
    <div className="flex justify-center p-3">
      <Button
        variant="blue"
        onClick={onClick}
        className={cn(
          'border border-transparent',
          active && 'border-blue-700 bg-blue-500',
          disabled ? 'cursor-default opacity-50' : 'cursor-pointer',
        )}
        disabled={disabled}
      >
        {label}
      </Button>
    </div>
  )
}

function OverageWarning() {
  return (
    <div className="mx-3 flex items-center gap-3">
      <FeatureSpacer>
        <AlertTriangle className="size-4 text-blue-900" />
      </FeatureSpacer>
      <SizableText className="text-muted-foreground py-3 italic">
        Service may be interrupted if resources are exceeded.
      </SizableText>
    </div>
  )
}

function siteCountLabel(count: number) {
  if (count === 1) {
    return '1 Site'
  }
  return `${count} Sites`
}

const PlanHeading = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn(
        'flex min-h-[100px] flex-col items-center border-b border-blue-700 p-3',
        className,
      )}
      {...props}
    />
  )
}

const PlanTitle = ({className, ...props}: TextProps) => {
  return (
    <Text
      weight="bold"
      size="lg"
      className={cn('text-muted-foreground mb-3 text-center', className)}
      {...props}
    />
  )
}

function formatPriceUSDCents(cents: number) {
  if (cents % 100 === 0) {
    return `$${cents / 100}`
  }
  return `$${(cents / 100).toFixed(2)}`
}

function PlanPrice({value, label}: {value: number; label?: string}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <SizableText className="text-blue-300">
        {label?.toUpperCase() || ' '}
      </SizableText>
      <div className="flex gap-1">
        <Text weight="bold" size="lg" className="text-muted-foreground">
          {formatPriceUSDCents(value)}
        </Text>
        <Text size="lg" className="text-muted-foreground">
          /mo
        </Text>
      </div>
    </div>
  )
}

function PlanFeature({label, plus}: {label: string; plus?: string}) {
  return (
    <div className="mb-2 flex flex-col gap-1">
      <div className="flex gap-3">
        <FeatureSpacer>
          <Check className="size-6 text-blue-900" />
        </FeatureSpacer>
        <FeatureText>{label}</FeatureText>
      </div>
      {plus ? (
        <PlusLabel>
          <Plus className="size-4" />
          <FeatureText className="text-black/80">{plus}</FeatureText>
        </PlusLabel>
      ) : null}
    </div>
  )
}

const FeatureSpacer = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn('flex h-6 w-6 items-center justify-center', className)}
      {...props}
    />
  )
}

const PlanFeatures = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn('flex flex-1 flex-col items-start p-3', className)}
      {...props}
    />
  )
}

const PlusLabel = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn(
        'ml-[38px] flex gap-2 rounded-sm bg-blue-50 p-1 px-2',
        className,
      )}
      {...props}
    />
  )
}

const PlanContainer = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn(
        'flex flex-1 flex-shrink-0 flex-col gap-2 rounded-lg border border-blue-700',
        className,
      )}
      {...props}
    />
  )
}

const FeatureText = ({className, ...props}: TextProps) => {
  return (
    <Text
      weight="bold"
      size="lg"
      className={cn('text-muted-foreground', className)}
      {...props}
    />
  )
}

function versionToInt(version: string): number | null {
  const parts = version.split('.')
  if (parts.length !== 3) return null
  return (
    parseInt(parts[0]) * 10_000 + parseInt(parts[1]) * 1000 + parseInt(parts[2])
  )
}

function isAppVersionEqualOrAbove(version: string) {
  if (VERSION === '0.0.0.local-dev') return true // for local dev
  if (VERSION.match('0.0.0.local')) return true // for local builds
  const expectedVersionInt = versionToInt(version)
  const currentVersionInt = versionToInt(VERSION)
  if (expectedVersionInt === null || currentVersionInt === null) return false
  return currentVersionInt >= expectedVersionInt
}

function SeedHostIntro({
  onSubmit,
  onBack,
  info,
  infoError,
  infoIsLoading,
}: {
  onSubmit: () => void
  onBack: () => void
  info?: HostInfoResponse
  infoError?: unknown
  infoIsLoading: boolean
}) {
  // Debug logging - initial state
  console.log('🔍 SeedHostIntro Debug:', {
    infoIsLoading,
    hasInfo: !!info,
    infoError:
      infoError instanceof Error ? infoError.message : String(infoError),
    info: info
      ? {
          serviceErrorMessage: info.serviceErrorMessage,
          minimumAppVersion: info.minimumAppVersion,
          // Log other relevant info properties without logging sensitive data
          hasPricing: !!info.pricing,
          hostDomain: info.hostDomain,
        }
      : null,
  })

  let content = infoIsLoading ? (
    <div className="flex items-center justify-center">
      <Spinner />
    </div>
  ) : null

  console.log(
    '📊 After initial assignment - content is:',
    content ? 'SPINNER' : 'NULL',
  )

  const isInvalidVersion =
    info?.minimumAppVersion && !isAppVersionEqualOrAbove(info.minimumAppVersion)

  console.log('🔍 Version check:', {
    minimumAppVersion: info?.minimumAppVersion,
    isInvalidVersion,
    currentVersion:
      typeof VERSION !== 'undefined' ? VERSION : 'VERSION_UNDEFINED',
  })

  if (info && !info.serviceErrorMessage && !isInvalidVersion) {
    console.log('✅ Setting content to SeedHostInfo - conditions met')
    content = <SeedHostInfo info={info} onSubmit={onSubmit} />
  } else if (infoError || info?.serviceErrorMessage || isInvalidVersion) {
    const invalidVersionMessage = isInvalidVersion
      ? 'The service has been updated. You must update to the latest version of the app.'
      : null
    console.log('❌ Setting content to error message:', {
      hasInfoError: !!infoError,
      infoErrorMessage:
        infoError instanceof Error ? infoError.message : String(infoError),
      serviceErrorMessage: info?.serviceErrorMessage,
      invalidVersionMessage,
    })
    content = (
      <SizableText className="text-destructive">
        {(infoError instanceof Error ? infoError.message : String(infoError)) ||
          info?.serviceErrorMessage ||
          invalidVersionMessage}
      </SizableText>
    )
  } else {
    console.log(
      '⚠️  No conditions met - content remains null. Conditions check:',
      {
        hasInfo: !!info,
        hasServiceError: !!info?.serviceErrorMessage,
        isInvalidVersion,
        hasInfoError: !!infoError,
        infoIsLoading,
      },
    )

    // 🔧 FIX: Add fallback content when no conditions are met
    console.log('🔧 Setting fallback content - no info available')
    content = (
      <div className="flex flex-col items-center gap-4 p-8">
        <SizableText className="text-muted-foreground text-center">
          Unable to load hosting service information.
        </SizableText>
        <SizableText className="text-muted-foreground text-center">
          Please check your internet connection and try again.
        </SizableText>
        <Button variant="inverse" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    )
  }

  console.log(
    '🎯 Final content state:',
    content ? content.type?.name || 'COMPONENT' : 'NULL',
  )

  return (
    <SeedHostContainer backButton={<BackButton onPress={onBack} />}>
      {content}
    </SeedHostContainer>
  )
}

const LoginSchema = z.object({
  email: z.string(),
})
type LoginFields = z.infer<typeof LoginSchema>
function SeedHostLogin({
  onAuthenticated,
  onBack,
}: {
  onAuthenticated: () => void
  onBack: () => void
}) {
  const {
    login,
    absorbedSession,
    email,
    isSendingEmail,
    isPendingEmailValidation,
    error,
    reset,
  } = useHostSession({onAuthenticated})

  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<LoginFields>({
    resolver: zodResolver(LoginSchema),
  })
  const onSubmit: SubmitHandler<LoginFields> = (data) => {
    login(data.email)
  }
  if (isPendingEmailValidation && email) {
    const errorMessage = error?.message || absorbedSession.error?.message
    return (
      <SeedHostContainer
        heading="Waiting for Email Validation"
        backButton={<BackButton onPress={onBack} />}
        footer={
          <Button onClick={reset} size="sm" className="self-center">
            <X className="size-3" />
            Cancel Login
          </Button>
        }
      >
        <DialogInner className="gap-4">
          {errorMessage ? (
            <>
              <ErrorBox error={errorMessage} />
              <Button onClick={reset}>Try Again</Button>
            </>
          ) : (
            <>
              <SizableText className="text-muted-foreground text-center">
                We sent a verification link to {email}. Click on it, and you
                will be logged in here.
              </SizableText>
              <div className="flex items-center justify-center">
                <Spinner />
              </div>
            </>
          )}
        </DialogInner>
      </SeedHostContainer>
    )
  }
  return (
    <SeedHostContainer
      heading="Login to Seed Hypermedia Hosting"
      backButton={<BackButton onPress={onBack} />}
    >
      <Form onSubmit={handleSubmit(onSubmit)} gap="$4">
        <FormField
          name="email"
          label="Email Address"
          errors={errors}
          width={400}
        >
          <FormInput
            disabled={isSendingEmail}
            control={control}
            name="email"
            placeholder="me@email.com"
          />
        </FormField>
        <Form.Trigger asChild>
          <BlueButton disabled={isSendingEmail}>
            {isSendingEmail ? 'Sending Email...' : 'Authenticate with Email'}
          </BlueButton>
        </Form.Trigger>
        <AnimatedSpinner isVisible={isSendingEmail} />
      </Form>
    </SeedHostContainer>
  )
}

const RegisterSubdomainSchema = z.object({
  subdomain: z
    .string()
    .min(4, 'Subdomain must be at least 4 characters long')
    .refine((val) => !val.endsWith('-'), 'Subdomain cannot end with a dash'),
})
type RegisterSubdomainFields = z.infer<typeof RegisterSubdomainSchema>
function SeedHostRegisterSubdomain({
  onBack,
  onLogout,
  info,
  onPublished,
  id,
}: {
  onBack: () => void
  onLogout: () => void
  onPublished: (host: string) => void
  id: UnpackedHypermediaId
  info?: HostInfoResponse
}) {
  const {loggedIn, email, createSite, logout} = useHostSession({})
  const register = useSiteRegistration(id.uid)

  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<RegisterSubdomainFields>({
    resolver: zodResolver(RegisterSubdomainSchema),
    defaultValues: {
      subdomain: '',
    },
  })
  if (!loggedIn) throw new Error('Not logged in')
  function onSubmit({subdomain}: RegisterSubdomainFields) {
    createSite
      .mutateAsync({subdomain})
      .then(async ({subdomain, registrationSecret, setupUrl, host}) => {
        const siteRegistration = await register.mutateAsync({
          url: setupUrl,
        })
        return {host}
      })
      .then(({host}) => {
        onPublished(host)
      })
  }
  useEffect(() => {
    setFocus('subdomain')
  }, [])
  const isSubmitting = register.isLoading || createSite.isLoading
  const errorText = register.error?.message || createSite.error?.message
  return (
    <SeedHostContainer
      heading="Register Hyper.Media Subdomain"
      backButton={<BackButton onPress={onBack} />}
      footer={
        <div className="flex">
          <SizableText size="sm" className="text-muted-foreground">
            Logged in as{' '}
          </SizableText>
          <HoverCard>
            <HoverCardTrigger>
              <SizableText className="text-blue-300" size="sm">
                {email}
              </SizableText>
            </HoverCardTrigger>
            <HoverCardContent>
              <div className="flex flex-col gap-2 p-2">
                <SizableText size="sm" className="text-muted-foreground">
                  Logged into{' '}
                  <Text weight="bold" className="text-muted-foreground">
                    {hostnameStripProtocol(SEED_HOST_URL)}
                  </Text>{' '}
                  as{' '}
                  <Text weight="bold" className="text-muted-foreground">
                    {email}
                  </Text>
                </SizableText>
                <Button
                  onClick={() => {
                    onLogout()
                    logout()
                  }}
                >
                  Log Out
                </Button>
              </div>
            </HoverCardContent>
          </HoverCard>
        </div>
      }
    >
      <Form onSubmit={handleSubmit(onSubmit)} gap="$4" ai="center">
        <FormField
          name="subdomain"
          label={`Select your unique sub-domain name on ${info?.hostDomain}`}
          errors={errors}
          width="70%"
        >
          <FormInput
            control={control}
            name="subdomain"
            placeholder="my-site-name"
            transformInput={(text) =>
              text
                .replace(/[ _]/g, '-')
                .replace(/[^a-zA-Z0-9-]/g, '')
                .toLowerCase()
            }
          />
        </FormField>
        <ErrorBox error={errorText} />
        <Form.Trigger asChild>
          <BlueButton>
            <UploadCloud className="size-4" />
            Publish Site
          </BlueButton>
        </Form.Trigger>
        <AnimatedSpinner isVisible={isSubmitting} />
      </Form>
    </SeedHostContainer>
  )
}

function AnimatedSpinner({isVisible}: {isVisible: boolean}) {
  return <Spinner className={isVisible ? 'opacity-100' : 'opacity-0'} />
}

function ErrorBox({error}: {error: string | null}) {
  if (!error) return null
  return (
    <div className="border-destructive flex items-center gap-3 rounded-md border p-3">
      <AlertCircle className="text-destructive size-6" />
      <p className="text-destructive">{error}</p>
    </div>
  )
}

function SeedHostSubdomainPublished({
  onClose,
  host,
  id,
  onCustomDomain,
}: {
  onClose: () => void
  host: string
  id: UnpackedHypermediaId
  onCustomDomain: () => void
}) {
  return (
    <SeedHostCongratsContainer
      heading="You Have Published to the Web!"
      graphic={<WebPublishedGraphic />}
      footer={
        <div className="flex flex-col gap-3">
          <SizableText className="text-muted-foreground">
            Now you can publish the site to your own domain.
          </SizableText>

          <div className="flex gap-3">
            <Button onClick={onClose}>
              <Check className="size-4" />
              Close
            </Button>
            <BlueButton onClick={onCustomDomain}>
              <ArrowRight className="size-4" />
              Publish Custom Domain
            </BlueButton>
          </div>
        </div>
      }
    >
      <SizableText className="text-muted-foreground">
        Here is the link to your new site.
      </SizableText>
      <PublishedUrl url={host} />
    </SeedHostCongratsContainer>
  )
}

function PublishedUrl({url}: {url: string}) {
  const {openUrl} = useUniversalAppContext()
  const textRef = useRef<any>(null)
  return (
    <XGroup borderColor="$blue8" borderWidth={1}>
      <div
        onClick={(e) => {
          e.preventDefault()
          if (textRef.current) {
            const range = document.createRange()

            range.selectNode(textRef.current)
            window.getSelection()?.removeAllRanges()
            window.getSelection()?.addRange(range)
          }
        }}
      >
        <XGroup.Item>
          <div className="flex flex-1 items-center">
            <Text size="md" className="mx-3 text-blue-300" ref={textRef}>
              {url}
            </Text>
            <Tooltip content="Copy URL">
              <Button
                variant="ghost"
                size="icon"
                className="m-2"
                onClick={() => {
                  copyTextToClipboard(url)
                  toast(`Copied ${url} URL`)
                }}
              >
                <Copy className="size-4" />
              </Button>
            </Tooltip>
          </div>
        </XGroup.Item>
      </div>
      <XGroup.Item>
        <BlueButton onClick={() => openUrl(url)}>
          Open
          <ExternalLink className="size-4" />
        </BlueButton>
      </XGroup.Item>
    </XGroup>
  )
}

const activelyWatchedDomainIds = new Set<string>()

export function useSeedHostDialog() {
  const {open, content} = useAppDialog(SeedHostDomainPublishedDialog)
  const {pendingDomains} = useHostSession()
  const watchingDomainsInProgress = useRef<
    {
      domainId: string
      siteUid: string
      hostname: string
    }[]
  >([])
  useEffect(() => {
    if (!pendingDomains) return
    pendingDomains?.forEach((p) => {
      if (!watchingDomainsInProgress.current.find((d) => d.domainId === p.id)) {
        watchingDomainsInProgress.current.push({
          domainId: p.id,
          siteUid: p.siteUid,
          hostname: p.hostname,
        })
      }
    })
    watchingDomainsInProgress.current.forEach((watchingDomain) => {
      if (!pendingDomains.find((p) => p.id === watchingDomain.domainId)) {
        watchingDomainsInProgress.current =
          watchingDomainsInProgress.current.filter(
            (pendingDomain) =>
              pendingDomain.domainId !== watchingDomain.domainId,
          )
        if (activelyWatchedDomainIds.has(watchingDomain.domainId)) {
          return
        }
        loadResource(hmId(watchingDomain.siteUid))
          .then((entity) => {
            const siteDocument =
              entity?.type === 'document' ? entity.document : undefined
            const siteUrl = siteDocument?.metadata?.siteUrl
            if (siteUrl && siteUrl === `https://${watchingDomain.hostname}`) {
              open({
                id: hmId(watchingDomain.siteUid),
                host: watchingDomain.hostname,
              })
            }
          })
          .catch((e) => {
            console.error('Pending Domain released, failed to load entity', e)
          })
      }
    })
  }, [pendingDomains])
  return {content}
}

function SeedHostDomainPublishedDialog({
  input,
  onClose,
}: {
  input: {
    id: UnpackedHypermediaId
    host: string
  }
  onClose: () => void
}) {
  return (
    <SeedHostDomainPublished
      onClose={onClose}
      host={input.host}
      id={input.id}
    />
  )
}

function SeedHostDomainPublished({
  onClose,
  host,
  id,
}: {
  onClose: () => void
  host: string
  id: UnpackedHypermediaId
}) {
  return (
    <SeedHostCongratsContainer
      heading={`Now Published to ${host}!`}
      graphic={<CongratsGraphic />}
    >
      <SizableText className="text-muted-foreground">
        Here is the link for your site.
      </SizableText>
      <PublishedUrl url={`https://${host}`} />
      <div className="flex">
        <BlueButton onClick={onClose}>
          <Check className="size-4" />
          Done
        </BlueButton>
      </div>
    </SeedHostCongratsContainer>
  )
}

const RegisterCustomDomainSchema = z.object({
  domain: z
    .string()
    .min(3, 'Domain is required')
    .regex(/^(?!.*\.\.)(?!.*\.$)(?!^\.)[a-z0-9.-]+$/, 'Invalid domain format'),
})
type RegisterCustomDomainFields = z.infer<typeof RegisterCustomDomainSchema>
function SeedHostRegisterCustomDomain({
  onBack,
  id,
  onClose,
}: {
  onBack?: () => void
  id: UnpackedHypermediaId
  onClose: () => void
}) {
  const {createDomain} = useHostSession()
  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<RegisterCustomDomainFields>({
    resolver: zodResolver(RegisterCustomDomainSchema),
  })
  const entity = useResource({...id, version: null, latest: true})
  const [localPendingDomain, setPendingDomain] = useState<{
    hostname: string
    domainId: string
  } | null>(null)
  const document =
    entity.data?.type === 'document' ? entity.data.document : undefined
  const siteUrl = document?.metadata?.siteUrl
  function onSubmit({domain}: RegisterCustomDomainFields) {
    if (!siteUrl) throw new Error('Site URL not found')
    createDomain
      .mutateAsync({
        hostname: domain,
        currentSiteUrl: siteUrl,
        id,
      })
      .then((d) => {
        setPendingDomain(d)
      })
  }
  const pendingDomain = useHostSession().pendingDomains?.find(
    (pending) => pending.siteUid === id.uid,
  )
  const pendingDomainId = localPendingDomain?.domainId
  useEffect(() => {
    if (pendingDomainId) {
      activelyWatchedDomainIds.add(pendingDomainId)
      return () => {
        activelyWatchedDomainIds.delete(pendingDomainId)
      }
    }
  }, [pendingDomainId])
  useEffect(() => {
    if (!pendingDomain && !localPendingDomain && siteUrl) {
      setFocus('domain')
    }
  }, [pendingDomain, localPendingDomain, siteUrl])
  if (pendingDomain) {
    let pendingStatus = null
    if (pendingDomain?.status === 'error') {
      pendingStatus = (
        <ErrorBox error="Something went wrong. Please try domain setup again." />
      )
    } else if (pendingDomain?.status === 'waiting-dns' && siteUrl) {
      pendingStatus = (
        <DialogInner>
          <DNSInstructions
            hostname={pendingDomain.hostname}
            siteUrl={siteUrl}
          />
        </DialogInner>
      )
    } else if (pendingDomain?.status === 'initializing') {
      pendingStatus = (
        <SizableText className="text-muted-foreground">
          Initializing your domain...
        </SizableText>
      )
    }
    return (
      <SeedHostContainer
        heading="Set Up Custom Domain"
        footer={
          <div className="flex flex-col gap-3">
            <SizableText className="text-muted-foreground">
              You can close this dialog and keep using the app.
            </SizableText>
            <BlueButton onClick={onClose}>Close</BlueButton>
          </div>
        }
      >
        {pendingStatus}
        <div className="flex items-center justify-center">
          <Spinner />
        </div>
      </SeedHostContainer>
    )
  }
  if (
    localPendingDomain &&
    siteUrl === `https://${localPendingDomain.hostname}`
  ) {
    return (
      <SeedHostDomainPublished
        host={localPendingDomain.hostname}
        onClose={onClose}
        id={id}
      />
    )
  }
  return (
    <SeedHostContainer
      heading={
        localPendingDomain
          ? `Setting up ${localPendingDomain.hostname}`
          : 'Set Up Custom Domain'
      }
      backButton={onBack ? <BackButton onPress={onBack} /> : null}
    >
      {siteUrl ? (
        <>
          <DialogInner>
            <SizableText className="text-muted-foreground">
              You can now publish to a domain that you own.
            </SizableText>
            <SizableText className="text-muted-foreground">
              On the next step you will be asked to update your DNS settings to
              point to the Seed Host service.
            </SizableText>
            <Form onSubmit={handleSubmit(onSubmit)} gap="$4">
              <FormField
                name="domain"
                label="What is your Domain Name?"
                errors={errors}
              >
                <FormInput
                  control={control}
                  name="domain"
                  placeholder="mydomain.com"
                  transformInput={(text) => {
                    if (text.match(/https?:\/\//)) {
                      text = text.replace(/https?:\/\//, '')
                    }
                    return text
                      .replace(/[ _]/g, '-')
                      .replace(/[^a-zA-Z0-9-\.]/g, '')
                      .toLowerCase()
                  }}
                />
              </FormField>
              {createDomain.error ? (
                <ErrorBox error={createDomain.error.message} />
              ) : null}
              <Form.Trigger asChild>
                <BlueButton>
                  Publish to Domain
                  <UploadCloud className="size-4" />
                </BlueButton>
              </Form.Trigger>
              <AnimatedSpinner isVisible={createDomain.isLoading} />
            </Form>
          </DialogInner>
        </>
      ) : (
        <SizableText className="text-muted-foreground">
          You need to publish your site first.
        </SizableText>
      )}
    </SeedHostContainer>
  )
}

export function DNSInstructions({
  hostname,
  siteUrl,
}: {
  hostname: string
  siteUrl: string
}) {
  const isSubd = isSubdomain(hostname)
  return (
    <div className="flex flex-col gap-3">
      <SizableText className="text-muted-foreground">
        Now is your time to change the DNS record for your domain.
      </SizableText>
      <SizableText className="text-muted-foreground">
        Set the{' '}
        <Text weight="bold" className="text-muted-foreground">
          {hostname}
        </Text>{' '}
        {isSubd ? 'CNAME' : 'ALIAS'} record to{' '}
        <Text weight="bold" className="text-muted-foreground">
          {hostnameStripProtocol(siteUrl)}.
        </Text>
      </SizableText>
      <SizableText className="text-muted-foreground">
        Once you update the DNS, it usually takes 10 minutes to propagate. Keep
        the app open until then.
      </SizableText>
    </div>
  )
}

function isSubdomain(hostname: string) {
  return hostname.split('.').length > 2
}

function SeedHostContent({
  onBack,
  onClose,
  id,
}: {
  onBack: () => void
  onClose: () => void
  id: UnpackedHypermediaId
}) {
  const {loggedIn, hostInfo} = useHostSession({})
  const [host, setHost] = useState<string | null>(null)
  const [mode, setMode] = useState<
    | 'intro'
    | 'login'
    | 'register-subdomain'
    | 'subdomain-published'
    | 'register-custom-domain'
  >('intro')
  if (mode === 'intro') {
    return (
      <SeedHostIntro
        onSubmit={() => setMode(loggedIn ? 'register-subdomain' : 'login')}
        onBack={onBack}
        info={hostInfo.data}
        infoError={hostInfo.error}
        infoIsLoading={hostInfo.isLoading}
      />
    )
  }
  if (mode === 'login') {
    return (
      <SeedHostLogin
        onAuthenticated={() => setMode('register-subdomain')}
        onBack={() => {
          setMode('intro')
        }}
      />
    )
  }
  if (mode === 'register-subdomain') {
    return (
      <SeedHostRegisterSubdomain
        id={id}
        info={hostInfo.data}
        onLogout={() => {
          setMode('login')
        }}
        onPublished={(host) => {
          setMode('subdomain-published')
          setHost(host)
        }}
        onBack={onBack}
      />
    )
  }
  if (mode === 'subdomain-published' && host) {
    return (
      <SeedHostSubdomainPublished
        onCustomDomain={() => setMode('register-custom-domain')}
        host={host}
        onClose={onClose}
        id={id}
      />
    )
  }
  if (mode === 'register-custom-domain') {
    return (
      <SeedHostRegisterCustomDomain
        id={id}
        onBack={() => {
          if (host) setMode('subdomain-published')
          else onClose()
        }}
        onClose={onClose}
      />
    )
  }

  return null
}

function SelfHostContent({
  onSetupUrl,
  onBack,
}: {
  onSetupUrl: () => void
  onBack: () => void
}) {
  const spawn = useNavigate('spawn')
  return (
    <PublishDialogContainer
      heading="Host on Your Own Server"
      backButton={<BackButton onPress={onBack} />}
    >
      <DialogInner>
        <SizableText className="text-muted-foreground text-center">
          You will need your own server and domain. Follow this guide to get
          started, and return when the setup script has printed the setup URL.
        </SizableText>
        <div className="my-6 flex justify-center">
          <Button
            onClick={() => {
              spawn(setupGuideRoute)
            }}
          >
            <ExternalLink className="size-4" />
            Open Setup Guide
          </Button>
        </div>
        <GreenButton onClick={onSetupUrl}>
          <ArrowRight className="size-4" />
          My Setup URL is Ready
        </GreenButton>
      </DialogInner>
    </PublishDialogContainer>
  )
}

function PublishWithUrl({
  id,
  onComplete,
  onBack,
}: {
  id: UnpackedHypermediaId
  onComplete: () => void
  onBack?: () => void
}) {
  const entity = useResource(id)
  const document =
    entity.data?.type === 'document' ? entity.data.document : undefined
  const replace = useNavigate('replace')
  const register = useSiteRegistration(id.uid)
  const onSubmit: SubmitHandler<PublishSiteFields> = (data) => {
    register.mutateAsync({url: data.url}).then((publishedUrl) => {
      onComplete()
      toast.success(`Site published to ${publishedUrl}`)
      // make sure the user is seeing the latest version of the site that now includes the url
      replace({key: 'document', id: {...id, version: null, latest: true}})
    })
  }
  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<PublishSiteFields>({
    resolver: zodResolver(publishSiteSchema),
    defaultValues: {
      url: '',
    },
  })
  useEffect(() => {
    setTimeout(() => {
      setFocus('url')
    }, 300) // wait for animation
  }, [setFocus])
  const spawn = useNavigate('spawn')
  return (
    <PublishDialogContainer
      heading={`Publish "${getDocumentTitle(
        document,
      )}" with a Hosting Setup URL`}
      backButton={onBack ? <BackButton onPress={onBack} /> : null}
    >
      {/* <DialogDescription>description</DialogDescription> */}
      <SizableText className="text-muted-foreground w-full text-center">
        The{' '}
        <ButtonText
          onPress={() => {
            spawn(setupGuideRoute)
          }}
          textDecorationLine="underline"
        >
          Server Setup
        </ButtonText>{' '}
        will output a setup URL for you to paste here.
      </SizableText>
      <Form onSubmit={handleSubmit(onSubmit)} gap="$4" alignItems="center">
        <FormField name="url" label="Site Setup URL" errors={errors}>
          <FormInput
            control={control}
            name="url"
            placeholder="https://mysite.com/hm/register?..."
            width={500}
          />
        </FormField>
        {register.error ? <ErrorBox error={register.error.message} /> : null}
        <Form.Trigger asChild>
          <GreenButton>
            <UploadCloud className="size-4" />
            Publish Site
          </GreenButton>
        </Form.Trigger>
        {register.isLoading ? (
          <div className="flex items-center justify-center">
            <Spinner />
          </div>
        ) : null}
      </Form>
    </PublishDialogContainer>
  )
}

const setupGuideId = hmId('z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS', {
  path: ['resources', 'self-host-seed'],
})
const setupGuideRoute: DocumentRoute = {
  key: 'document',
  id: setupGuideId,
}
