import {useExperiments} from '@/models/experiments'
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
import {loadEntity, useEntity} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {FormInput} from '@shm/ui/form-input'
import {FormField} from '@shm/ui/forms'
import {HoverCard} from '@shm/ui/hover-card'
import {
  IconComponent,
  PasteSetupUrl,
  SeedHost,
  SelfHost,
  UploadCloud,
} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Plus,
} from '@tamagui/lucide-icons'
import {useEffect, useRef, useState} from 'react'
import {SubmitHandler, useForm} from 'react-hook-form'
import {
  AlertDialog,
  ButtonText,
  Form,
  Heading,
  SizableText,
  styled,
  TamaguiTextElement,
  Text,
  Theme,
  ThemeName,
  View,
  XGroup,
  XStack,
  YStack,
} from 'tamagui'
import {z} from 'zod'
import {useAppDialog} from './dialog'
import {
  CelebrationDotsLeft,
  CelebrationDotsRight,
  CongratsGraphic,
  WebPublishedGraphic,
} from './publish-graphics'

const publishDialogContentProps = {
  maxWidth: null,
  maxHeight: null,
  height: 'content-fit',
  width: 'content-fit',
  overflow: 'hidden',
  padding: 0,
} as const

export function usePublishSite() {
  return useAppDialog(PublishSiteDialog, {
    contentProps: publishDialogContentProps,
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
    <YStack gap="$4" padding="$4" borderRadius="$3">
      <AlertDialog.Title>Remove Site</AlertDialog.Title>
      <AlertDialog.Description>
        Remove this site URL from the entity? Your site will still exist until
        you delete the server.
      </AlertDialog.Description>

      <XStack gap="$3" justifyContent="flex-end">
        <AlertDialog.Cancel asChild>
          <Button
            onPress={() => {
              onClose()
            }}
            chromeless
          >
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <AlertDialog.Action asChild>
          <Button
            theme="red"
            onPress={() => {
              removeSite.mutate()
              onClose()
            }}
          >
            Remove Site
          </Button>
        </AlertDialog.Action>
      </XStack>
    </YStack>
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
    <YStack
      gap="$4"
      padding="$4"
      maxWidth={1000}
      maxHeight={800}
      width="80vw"
      height="80vh"
      alignItems="center"
      position="relative"
    >
      {heading ? <Heading size="$2">{heading}</Heading> : null}
      {backButton ? (
        <View position="absolute" top={'$4'} left={'$4'}>
          {backButton}
        </View>
      ) : null}
      <YStack f={1} jc="center" ai="center" gap="$4">
        {children}
      </YStack>
    </YStack>
  )
}

function SeedHostHeader() {
  return (
    <XStack gap="$2" ai="center" marginTop="$6">
      <SeedHost color="#ffffff" size={32} />
      <Text fontSize={22} fontWeight="bold" color="#ffffff">
        Hosting by Seed Hypermedia
      </Text>
    </XStack>
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
    <Theme name="dark_blue">
      <YStack
        gap="$4"
        padding="$4"
        maxWidth={1000}
        maxHeight={800}
        width="80vw"
        height="80vh"
        alignItems="center"
        backgroundColor="#1c1c1c"
        position="relative"
      >
        <SeedHostHeader />
        {backButton ? (
          <View position="absolute" top={'$4'} left={'$4'}>
            {backButton}
          </View>
        ) : null}
        <YStack f={1} jc="center" ai="center" gap="$3">
          {heading ? (
            <Text
              fontSize={28}
              fontWeight="bold"
              marginBottom="$4"
              textAlign="center"
            >
              {heading}
            </Text>
          ) : null}
          {children}
        </YStack>
        {footer ? footer : null}
      </YStack>
    </Theme>
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
      <YStack
        gap="$4"
        padding="$4"
        maxWidth={1000}
        maxHeight={800}
        width="80vw"
        height="80vh"
        alignItems="center"
        backgroundColor="$background"
        position="relative"
      >
        <View
          position="absolute"
          top={80}
          bottom={0}
          left={0}
          scale={1.2}
          animation="superSlow"
          enterStyle={{left: -200, scale: 8}}
        >
          <CelebrationDotsLeft />
        </View>
        <View
          position="absolute"
          top={80}
          bottom={0}
          right={0}
          scale={1.2}
          animation="superSlow"
          enterStyle={{right: -200, scale: 8}}
        >
          <CelebrationDotsRight />
        </View>
        <SeedHostHeader />
        <YStack f={1} jc="center" ai="center" gap="$4">
          {graphic ? (
            <View
              enterStyle={{
                scale: 1.5,
                y: -10,
                opacity: 0,
              }}
              animation="bounce"
              y={0}
              opacity={1}
              scale={1}
            >
              {graphic}
            </View>
          ) : null}
          {heading ? (
            <Text
              fontSize={28}
              fontWeight="bold"
              marginBottom="$4"
              textAlign="center"
            >
              {heading}
            </Text>
          ) : null}
          {children}
        </YStack>
        {footer ? footer : null}
      </YStack>
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
  const experiments = useExperiments()
  const {id, step: initialStep} = input
  const [mode, setMode] = useState<
    'input-url' | 'self-host' | 'seed-host' | 'seed-host-custom-domain' | null
  >(initialStep || null)
  if (!experiments.data?.hosting) {
    return <PublishWithUrl id={id} onComplete={onClose} />
  }
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
      <YStack f={1} jc="center">
        <DialogInner>
          <SizableText textAlign="center">
            How would you like to publish to the web?
          </SizableText>
          <YStack
            backgroundColor="$color6"
            borderRadius="$3"
            padding="$2"
            gap="$2"
          >
            <PublishOptionButton
              icon={SeedHost}
              onPress={() => setMode('seed-host')}
              label="Free Hosting by Seed Hypermedia"
              theme="blue"
              height={60}
            />
            <PublishOptionButton
              icon={SelfHost}
              onPress={() => setMode('self-host')}
              label="Self Host on Your Own Server"
            />
            <PublishOptionButton
              icon={PasteSetupUrl}
              onPress={() => setMode('input-url')}
              label="Paste a Hosting Setup URL"
            />
          </YStack>
        </DialogInner>
      </YStack>
    </PublishDialogContainer>
  )
}

const DialogInner = styled(YStack, {
  maxWidth: 400,
  gap: '$2',
})

const BlueButton = styled(Button, {
  backgroundColor: '$blue8',
  hoverStyle: {
    backgroundColor: '$blue7',
  },
})

const GreenButton = styled(Button, {
  backgroundColor: '$green10',
  hoverStyle: {
    backgroundColor: '$green9',
  },
  color: '$color1',
})

function PublishOptionButton({
  icon: Icon,
  onPress,
  label,
  color,
  height,
  theme,
}: {
  icon: IconComponent
  onPress: () => void
  label: string
  color?: string
  height?: number
  theme?: ThemeName
}) {
  return (
    <Button onPress={onPress} height={height} theme={theme}>
      <XStack f={1} ai="center" gap="$2">
        <Icon color={color} size={32} />
        <SizableText color={color}>{label}</SizableText>
      </XStack>
    </Button>
  )
}

function BackButton({onPress}: {onPress: () => void}) {
  return <Button onPress={onPress} icon={ArrowLeft} chromeless />
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
      <SizableText>
        Error: Service unavailable or incompatible with this version of Seed.
      </SizableText>
    )
  }
  return (
    <YStack gap="$3" maxWidth={600}>
      <SizableText textAlign="center">
        Seed offers free server hosting with a generous storage and bandwidth
        limit, perfect for getting started. If your needs grow beyond the free
        tier, you can easily purchase additional capacity to scale seamlessly.
      </SizableText>
      <SizableText color="$blue11" textAlign="center">
        By using Seed, you're supporting{' '}
        <SizableText fontWeight="bold" color="$blue11">
          Open Source Software
        </SizableText>
        , helping to build a more open and collaborative digital future.
      </SizableText>
      <XStack gap="$3" justifyContent="center" marginTop="$4">
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
          <SelectPlanButton active onPress={onSubmit} />
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
      </XStack>
      <XStack
        borderWidth={1}
        borderColor="$blue7"
        borderRadius="$3"
        padding="$3"
        marginBottom="$4"
        jc="center"
      >
        <SizableText>
          For large organizations,{' '}
          <SizableText
            tag="a"
            textDecorationLine="underline"
            href="mailto:sales@seedhypermedia.com"
          >
            contact us
          </SizableText>{' '}
          for a customized plan.
        </SizableText>
      </XStack>
    </YStack>
  )
}

function SelectPlanButton({
  active,
  comingSoon,
  onPress,
}: {
  active?: boolean
  comingSoon?: boolean
  onPress?: () => void
}) {
  const label = active ? 'Get Started' : comingSoon ? 'Coming Soon' : 'Select'
  const buttonColor = active ? '$blue9' : 'transparent'
  const disabled = active || comingSoon
  return (
    <XStack padding="$3" jc="center">
      <Button
        onPress={onPress}
        backgroundColor={active ? '$blue9' : 'transparent'}
        hoverStyle={{
          backgroundColor: disabled ? buttonColor : '$blue10',
          borderColor: active ? undefined : '$blue9',
        }}
        pressStyle={{
          backgroundColor: disabled ? buttonColor : '$blue10',
        }}
        borderWidth={1}
        focusStyle={{
          borderColor: active ? undefined : '$blue9',
          borderWidth: 1,
        }}
        borderColor={active ? undefined : '$blue9'}
        opacity={1}
        cursor={disabled ? 'default' : 'pointer'}
      >
        {label}
      </Button>
    </XStack>
  )
}

function OverageWarning() {
  return (
    <XStack gap="$3" alignItems="center" marginHorizontal="$3">
      <FeatureSpacer>
        <AlertTriangle size={24} color="$blue9" />
      </FeatureSpacer>
      <SizableText fontStyle="italic" size="$3" paddingVertical="$3">
        Service may be interrupted if resources are exceeded.
      </SizableText>
    </XStack>
  )
}

function siteCountLabel(count: number) {
  if (count === 1) {
    return '1 Site'
  }
  return `${count} Sites`
}

const PlanHeading = styled(YStack, {
  borderBottomWidth: 1,
  borderColor: '$blue7',
  alignItems: 'center',
  padding: '$3',
  minHeight: 100,
})

const PlanTitle = styled(Text, {
  fontWeight: 'bold',
  textAlign: 'center',
  fontSize: 22,
  marginBottom: '$3',
})

function formatPriceUSDCents(cents: number) {
  if (cents % 100 === 0) {
    return `$${cents / 100}`
  }
  return `$${(cents / 100).toFixed(2)}`
}

function PlanPrice({value, label}: {value: number; label?: string}) {
  return (
    <YStack gap="$1" alignItems="center">
      <SizableText color="$blue11">{label?.toUpperCase() || ' '}</SizableText>
      <XStack gap="$1">
        <Text fontWeight="bold" fontSize={32}>
          {formatPriceUSDCents(value)}
        </Text>
        <Text fontSize={28}>/mo</Text>
      </XStack>
    </YStack>
  )
}

function PlanFeature({label, plus}: {label: string; plus?: string}) {
  return (
    <YStack marginBottom="$2" gap="$1">
      <XStack gap="$3">
        <FeatureSpacer>
          <Check size={24} color="$blue9" />
        </FeatureSpacer>
        <FeatureText>{label}</FeatureText>
      </XStack>
      {plus ? (
        <PlusLabel>
          <Plus color="$color11" size="$1" />
          <FeatureText color="$color11">{plus}</FeatureText>
        </PlusLabel>
      ) : null}
    </YStack>
  )
}

const FeatureSpacer = styled(XStack, {
  width: 24,
  height: 24,
  alignItems: 'center',
  justifyContent: 'center',
})

const PlanFeatures = styled(YStack, {
  padding: '$3',
  alignItems: 'flex-start',
  flex: 1,
})

const PlusLabel = styled(XStack, {
  marginLeft: 38,
  backgroundColor: '$blue5',
  gap: '$2',
  padding: '$1',
  borderRadius: '$2',
  paddingHorizontal: '$2',
})

const PlanContainer = styled(YStack, {
  flexGrow: 1,
  flexBasis: 1,
  flexShrink: 0,
  borderRadius: '$3',
  borderWidth: 1,
  borderColor: '$blue7',
  gap: '$2',
})

const FeatureText = styled(SizableText, {})

function versionToInt(version: string): number | null {
  const parts = version.split('.')
  if (parts.length !== 3) return null
  return (
    parseInt(parts[0]) * 10_000 + parseInt(parts[1]) * 1000 + parseInt(parts[2])
  )
}

function isAppVersionEqualOrAbove(version: string) {
  if (VERSION === '0.0.0.local-dev') return true // for local dev
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
  let content = infoIsLoading ? <Spinner /> : null
  const isInvalidVersion =
    info?.minimumAppVersion && !isAppVersionEqualOrAbove(info.minimumAppVersion)
  if (info && !info.serviceErrorMessage && !isInvalidVersion) {
    content = <SeedHostInfo info={info} onSubmit={onSubmit} />
  } else if (infoError || info?.serviceErrorMessage || isInvalidVersion) {
    const invalidVersionMessage = isInvalidVersion
      ? 'The service has been updated. You must update to the latest version of the app.'
      : null
    content = (
      <SizableText color="$red11">
        {infoError?.message ||
          info?.serviceErrorMessage ||
          invalidVersionMessage}
      </SizableText>
    )
  }
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
    return (
      <SeedHostContainer
        heading="Waiting for Email Validation"
        backButton={<BackButton onPress={onBack} />}
      >
        <DialogInner gap="$4">
          {error || absorbedSession.error ? (
            <>
              <ErrorBox
                error={error?.message || absorbedSession.error?.message}
              />
              <Button onPress={reset}>Try Again</Button>
            </>
          ) : (
            <>
              <SizableText textAlign="center">
                We sent a verification link to {email}. Click on it, and you
                will be logged in here.
              </SizableText>
              <Spinner />
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
  subdomain: z.string(),
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
  const isSubmitting = register.isLoading || createSite.isLoading
  const errorText = register.error?.message || createSite.error?.message
  return (
    <SeedHostContainer
      heading="Register Hyper.Media Subdomain"
      backButton={<BackButton onPress={onBack} />}
      footer={
        <XStack>
          <SizableText fontSize="$1">Logged in as </SizableText>
          <HoverCard
            content={
              <YStack gap="$2" padding="$2">
                <SizableText fontSize="$1">
                  Logged into{' '}
                  <Text fontWeight="bold">
                    {hostnameStripProtocol(SEED_HOST_URL)}
                  </Text>{' '}
                  as <Text fontWeight="bold">{email}</Text>
                </SizableText>
                <Button
                  onPress={() => {
                    onLogout()
                    logout()
                  }}
                >
                  Log Out
                </Button>
              </YStack>
            }
          >
            <SizableText color="$blue11" fontSize="$1">
              {email}
            </SizableText>
          </HoverCard>
        </XStack>
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
            // appendix={info?.hostDomain}
          />
        </FormField>
        <ErrorBox error={errorText} />
        <Form.Trigger asChild>
          <BlueButton icon={UploadCloud}>Publish Site</BlueButton>
        </Form.Trigger>
        <AnimatedSpinner isVisible={isSubmitting} />
      </Form>
    </SeedHostContainer>
  )
}

function AnimatedSpinner({isVisible}: {isVisible: boolean}) {
  return (
    <Spinner
      transition="opacity 0.5s ease-in-out"
      opacity={isVisible ? 1 : 0}
    />
  )
}

function ErrorBox({error}: {error: string | null}) {
  if (!error) return null
  return (
    <XStack
      gap="$3"
      alignItems="center"
      padding="$3"
      borderWidth={1}
      borderColor="$red11"
      borderRadius="$3"
    >
      <AlertCircle size={24} color="$red11" />
      <SizableText color="$red11">{error}</SizableText>
    </XStack>
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
        <YStack gap="$3">
          <SizableText>
            Now you can publish the site to your own domain.
          </SizableText>

          <XStack gap="$3">
            <Button onPress={onClose} icon={Check}>
              Close
            </Button>
            <BlueButton onPress={onCustomDomain} iconAfter={ArrowRight}>
              Publish Custom Domain
            </BlueButton>
          </XStack>
        </YStack>
      }
    >
      <SizableText>Here is the link to your new site.</SizableText>
      <PublishedUrl url={host} />
    </SeedHostCongratsContainer>
  )
}

function PublishedUrl({url}: {url: string}) {
  const {openUrl} = useUniversalAppContext()
  const textRef = useRef<TamaguiTextElement>(null)
  return (
    <XGroup borderColor="$blue8" borderWidth={1}>
      <div
        onClick={(e) => {
          e.preventDefault()
          if (textRef.current) {
            const range = document.createRange()
            // @ts-expect-error
            range.selectNode(textRef.current)
            window.getSelection()?.removeAllRanges()
            window.getSelection()?.addRange(range)
          }
        }}
      >
        <XGroup.Item>
          <XStack flex={1} alignItems="center">
            <Text
              fontSize={18}
              color="$blue11"
              ref={textRef}
              marginHorizontal="$3"
            >
              {url}
            </Text>
            <Tooltip content="Copy URL">
              <Button
                chromeless
                size="$2"
                margin="$2"
                icon={Copy}
                onPress={() => {
                  copyTextToClipboard(url)
                  toast(`Copied ${url} URL`)
                }}
              />
            </Tooltip>
          </XStack>
        </XGroup.Item>
      </div>
      <XGroup.Item>
        <BlueButton onPress={() => openUrl(url)} iconAfter={ExternalLink}>
          Open
        </BlueButton>
      </XGroup.Item>
    </XGroup>
  )
}

const activelyWatchedDomainIds = new Set<string>()

export function useSeedHostDialog() {
  const {open, content} = useAppDialog(SeedHostDomainPublishedDialog, {
    contentProps: publishDialogContentProps,
  })
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
          console.log(
            'Domain is actively watched, skipping',
            watchingDomain.domainId,
          )
          return
        }
        loadEntity(hmId('d', watchingDomain.siteUid))
          .then((entity) => {
            const siteUrl = entity?.document?.metadata?.siteUrl
            if (siteUrl && siteUrl === `https://${watchingDomain.hostname}`) {
              open({
                id: hmId('d', watchingDomain.siteUid),
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
      <SizableText>Here is the link for your site.</SizableText>
      <PublishedUrl url={`https://${host}`} />
      <XStack>
        <BlueButton onPress={onClose} icon={Check}>
          Done
        </BlueButton>
      </XStack>
    </SeedHostCongratsContainer>
  )
}

const RegisterCustomDomainSchema = z.object({
  domain: z.string(),
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
  const entity = useEntity({...id, version: null, latest: true})
  const [localPendingDomain, setPendingDomain] = useState<{
    hostname: string
    domainId: string
  } | null>(null)
  const siteUrl = entity.data?.document?.metadata?.siteUrl
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
      console.log('Adding domain to actively watched domains', pendingDomainId)
      activelyWatchedDomainIds.add(pendingDomainId)
      return () => {
        console.log(
          'Removing domain from actively watched domains',
          pendingDomainId,
        )
        activelyWatchedDomainIds.delete(pendingDomainId)
      }
    }
  }, [pendingDomainId])
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
      pendingStatus = <SizableText>Initializing your domain...</SizableText>
    }
    return (
      <SeedHostContainer
        heading="Set Up Custom Domain"
        footer={
          <YStack gap="$3">
            <SizableText>
              You can close this dialog and keep using the app.
            </SizableText>
            <BlueButton onPress={onClose}>Close</BlueButton>
          </YStack>
        }
      >
        {pendingStatus}
        <Spinner />
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
            <SizableText>
              You can now publish to a domain that you own.
            </SizableText>
            <SizableText>
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
                />
              </FormField>
              {createDomain.error ? (
                <ErrorBox error={createDomain.error.message} />
              ) : null}
              <Form.Trigger asChild>
                <BlueButton iconAfter={UploadCloud}>
                  Publish to Domain
                </BlueButton>
              </Form.Trigger>
              <AnimatedSpinner isVisible={createDomain.isLoading} />
            </Form>
          </DialogInner>
        </>
      ) : (
        <SizableText>You need to publish your site first.</SizableText>
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
    <YStack gap="$3">
      <SizableText>
        Now is your time to change the DNS record for your domain.
      </SizableText>
      <SizableText>
        Set the <Text fontWeight="bold">{hostname}</Text>{' '}
        {isSubd ? 'CNAME' : 'ALIAS'} record to{' '}
        <Text fontWeight="bold">{hostnameStripProtocol(siteUrl)}.</Text>
      </SizableText>
      <SizableText>
        Once you update the DNS, it usually takes 10 minutes to propagate. Keep
        the app open until then.
      </SizableText>
    </YStack>
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
        <SizableText>
          You will need your own server and domain. Follow this guide to get
          started, and return when the setup script has printed the setup URL.
        </SizableText>
        <XStack jc="center" marginVertical="$6">
          <Button
            icon={ExternalLink}
            backgroundColor="$color4"
            hoverStyle={{backgroundColor: '$color3'}}
            onPress={() => {
              spawn(setupGuideRoute)
            }}
          >
            Open Setup Guide
          </Button>
        </XStack>
        <GreenButton onPress={onSetupUrl} iconAfter={ArrowRight}>
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
  const entity = useEntity(id)
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
        entity.data?.document,
      )}" with a Hosting Setup URL`}
      backButton={onBack ? <BackButton onPress={onBack} /> : null}
    >
      {/* <DialogDescription>description</DialogDescription> */}
      <SizableText>
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
          <GreenButton icon={UploadCloud}>Publish Site</GreenButton>
        </Form.Trigger>
        {register.isLoading ? <Spinner /> : null}
      </Form>
    </PublishDialogContainer>
  )
}

const setupGuideId = hmId(
  'd',
  'z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS',
  {
    path: ['resources', 'self-host-seed'],
  },
)
const setupGuideRoute: DocumentRoute = {
  key: 'document',
  id: setupGuideId,
}
