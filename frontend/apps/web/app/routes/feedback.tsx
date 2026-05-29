import {
  FEEDBACK_CONFIG,
  FEEDBACK_ROUTE_PATH,
  type FeedbackFormValues,
  hasMeaningfulFeedback,
  normalizeFeedbackFormValues,
  publishFeedbackDocument,
} from '@/feedback'
import {useCreateAccount, useLocalKeyPair} from '@/auth'
import {resolveWebCanEdit} from '@/document-edit/use-web-can-edit'
import {loadSiteHeaderData, type SiteHeaderPayload} from '@/loaders'
import {defaultSiteIcon} from '@/meta'
import {PageFooter} from '@/page-footer'
import {getOptimizedImageUrl, NavigationLoadingContent, WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {reportError} from '@/report-error'
import {WebSiteHeader} from '@/web-site-header'
import {unwrap} from '@/wrapping'
import {wrapJSON} from '@/wrapping.server'
import {getDaemonAuthToken, withDaemonAuthToken} from '@/daemon-auth.server'
import {LoaderFunctionArgs, LinksFunction, MetaFunction} from '@remix-run/node'
import {MetaDescriptor, useLoaderData} from '@remix-run/react'
import {routeToHref, useUniversalAppContext, useUniversalClient} from '@shm/shared'
import {useCapabilities} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Textarea} from '@shm/ui/components/textarea'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {Spinner} from '@shm/ui/spinner'
import {cn} from '@shm/ui/utils'
import {useMutation} from '@tanstack/react-query'
import {AlertCircle, ArrowUpRight, Check, Lock} from 'lucide-react'
import type {FormEvent, ReactNode} from 'react'
import {useMemo, useState} from 'react'

type FeedbackPagePayload = SiteHeaderPayload

type PublishSuccessState = {
  href: string
  privateLabel: string
  submittedAt: string
}

const FONT_PRECONNECTS = [
  {rel: 'preconnect', href: 'https://fonts.googleapis.com'},
  {rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' as const},
]

const INITIAL_VALUES: FeedbackFormValues = {
  name: '',
  email: '',
  firstImpression: '',
  possibleActions: '',
  howToComment: '',
  howToShare: '',
  clarity: '',
  foundCommentButton: '',
  oneChange: '',
}

const CLARITY_OPTIONS = ['1', '2', '3', '4', '5'] as const
const COMMENT_BUTTON_OPTIONS = ['Sí', 'No', 'No lo busqué'] as const

/** Load site chrome for the `/feedback` utility page. */
export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const authToken = await getDaemonAuthToken(request)
  return withDaemonAuthToken(authToken, async () => {
    const headerData = await loadSiteHeaderData(parsedRequest)
    return wrapJSON(headerData satisfies FeedbackPagePayload)
  })
}

/** Load the editorial fonts used by the preserved feedback design. */
export const links: LinksFunction = () => [
  ...FONT_PRECONNECTS,
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500&display=swap',
  },
]

/** Set a site-specific browser title and icon for the feedback page. */
export const meta: MetaFunction<typeof loader> = ({data}) => {
  const {homeMetadata} = unwrap<FeedbackPagePayload>(data)
  const meta: MetaDescriptor[] = []
  const homeIconCid = homeMetadata?.icon ? extractIpfsUrlCid(homeMetadata.icon) : null
  const homeIcon = homeIconCid ? getOptimizedImageUrl(homeIconCid, 'S') : null
  meta.push({
    tagName: 'link',
    rel: 'icon',
    href: homeIcon || defaultSiteIcon,
    type: 'image/png',
  })
  meta.push({title: FEEDBACK_CONFIG.pageTitle})
  return meta
}

export default function FeedbackRoute() {
  const {originHomeId, siteHost, origin, homeMetadata, dehydratedState} = unwrap<FeedbackPagePayload>(useLoaderData())
  if (!originHomeId) {
    return <h2>Invalid origin home id</h2>
  }

  return (
    <WebSiteProvider origin={origin} originHomeId={originHomeId} siteHost={siteHost} dehydratedState={dehydratedState}>
      <div className="flex min-h-screen flex-1 flex-col items-center">
        <WebSiteHeader
          homeMetadata={homeMetadata}
          originHomeId={originHomeId}
          siteHomeId={originHomeId}
          docId={null}
          origin={origin}
        />
        <NavigationLoadingContent className="flex w-full max-w-5xl flex-1 flex-col px-4 pb-16 pt-[var(--site-header-h)] sm:pt-0">
          <FeedbackPageBody originHomeId={originHomeId} homeMetadata={homeMetadata} />
        </NavigationLoadingContent>
        <PageFooter className="w-full" hideDeviceLinkToast />
      </div>
    </WebSiteProvider>
  )
}

function FeedbackPageBody({
  originHomeId,
  homeMetadata,
}: {
  originHomeId: NonNullable<FeedbackPagePayload['originHomeId']>
  homeMetadata: FeedbackPagePayload['homeMetadata']
}) {
  const client = useUniversalClient()
  const authDialog = useCreateAccount({})
  const keyPair = useLocalKeyPair()
  const capabilities = useCapabilities(originHomeId)
  const {origin, originHomeId: contextualOriginHomeId} = useUniversalAppContext()
  const [values, setValues] = useState<FeedbackFormValues>(INITIAL_VALUES)
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState<PublishSuccessState | null>(null)

  const siteName = homeMetadata?.name?.trim() || FEEDBACK_CONFIG.testedPageLabel
  const targetAccountLabel = `${siteName} (${originHomeId.uid})`
  const logoCid = homeMetadata?.icon ? extractIpfsUrlCid(homeMetadata.icon) : null
  const logoSrc = logoCid ? getOptimizedImageUrl(logoCid, 'M') : null

  const access = useMemo(
    () =>
      resolveWebCanEdit({
        docId: originHomeId,
        delegatedAccountUid: keyPair?.delegatedAccountUid ?? null,
        origin: origin ?? null,
        originHomeId: contextualOriginHomeId ?? null,
        capabilities: capabilities.data,
        isBrowser: typeof window !== 'undefined',
      }),
    [capabilities.data, contextualOriginHomeId, keyPair?.delegatedAccountUid, origin, originHomeId],
  )

  const submitFeedback = useMutation({
    mutationFn: async (normalizedValues: FeedbackFormValues) => {
      if (!client.getSigner) {
        throw new Error('Browser signer unavailable for feedback publish')
      }
      if (!access.signingAccountId) {
        throw new Error('No signing account available for feedback publish')
      }

      return await publishFeedbackDocument(
        {
          request: client.request,
          publish: client.publish,
          getSigner: client.getSigner,
        },
        normalizedValues,
        {
          publishAccountUid: originHomeId.uid,
          signingAccountUid: access.signingAccountId,
          capabilityCid: access.capability?.id === '_owner' ? '' : access.capability?.id,
          publishedUnderLabel: siteName,
          publishedUnderAccountUid: originHomeId.uid,
        },
      )
    },
    onSuccess: (result) => {
      const href =
        routeToHref(
          {key: 'document', id: result.documentId},
          {
            origin,
            originHomeId,
          },
        ) || result.documentId.id
      setSuccess({
        href,
        privateLabel: targetAccountLabel,
        submittedAt: result.submittedAt,
      })
      setFormError(null)
    },
    onError: (error) => {
      reportError(error, {
        feature: 'feedback',
        operation: 'publish-feedback',
        publishAccountUid: originHomeId.uid,
        route: FEEDBACK_ROUTE_PATH,
      })
      setFormError('No hemos podido guardar tu feedback. Puedes revisar tus respuestas e intentarlo de nuevo.')
    },
  })

  const submitDisabled = submitFeedback.isPending

  function updateField<K extends keyof FeedbackFormValues>(key: K, value: FeedbackFormValues[K]) {
    setValues((current) => ({...current, [key]: value}))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedValues = normalizeFeedbackFormValues(values)
    setValues(normalizedValues)

    if (!hasMeaningfulFeedback(normalizedValues)) {
      setFormError('Añade al menos una respuesta de feedback antes de enviarlo.')
      return
    }

    setFormError(null)
    submitFeedback.mutate(normalizedValues)
  }

  const showAuthGate = !keyPair
  const showCapabilityLoading = !showAuthGate && capabilities.isLoading
  const showCapabilityError = !showAuthGate && !showCapabilityLoading && !access.canEdit

  return (
    <div className="mx-auto w-full max-w-3xl py-10 text-[#1a1a18]" style={{fontFamily: '"DM Sans", sans-serif'}}>
      {authDialog.content}
      <div className="relative overflow-hidden rounded-[28px] border border-[#d3d1c7] bg-[#f0ede4] px-6 py-8 shadow-[0_24px_80px_rgba(46,46,35,0.08)] sm:px-10 sm:py-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.65),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(29,158,117,0.08),transparent_32%)]" />
        {logoSrc ? (
          <div className="absolute right-6 top-6 z-10 size-11 overflow-hidden rounded-full border border-white/60 shadow-sm">
            <img src={logoSrc} alt={siteName} className="size-full object-cover" />
          </div>
        ) : null}

        <div className="relative z-10 flex flex-col gap-8">
          <header className="max-w-2xl">
            <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.18em] text-[#888780]">Feedback privado</p>
            <h1
              className="text-[2.35rem] leading-[1.08] text-[#1a1a18] sm:text-[2.8rem]"
              style={{fontFamily: '"Libre Baskerville", serif'}}
            >
              Ayúdanos a mejorar
              <br />
              <span className="italic text-[#1d9e75]">compartiendo tu feedback</span>
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-[#5f5e5a]">
              Estamos construyendo un lugar para crear conocimiento, leer, comentar y conectar — sin un servidor
              central que lo controle.
              <span className="mt-2 block">Este test dura unos 8–10 minutos, muchas gracias por tu tiempo.</span>
            </p>
          </header>

          <div className="rounded-2xl border border-[#d3d1c7] border-l-[3px] border-l-[#1d9e75] bg-white px-5 py-5 shadow-[0_10px_30px_rgba(49,47,38,0.03)]">
            <span className="mb-3 block text-[13px] font-medium uppercase tracking-[0.08em] text-[#1d9e75]">
              Tu tarea
            </span>
            <p className="mb-3 text-sm leading-7 text-[#2c2c2a]">
              Abre el enlace, echa un vistazo a lo que ves durante un par de minutos y lee lo que te llame la
              atención. A continuación responde a las preguntas.
            </p>
            <p className="mb-4 text-sm leading-7 text-[#2c2c2a]">
              No te preocupes por hacerlo “bien” — tu confusión es el feedback más valioso que podemos recibir.
            </p>
            <a
              href={FEEDBACK_CONFIG.testedPageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-[#1d9e75] underline underline-offset-4"
            >
              ↗ Abrir {FEEDBACK_CONFIG.testedPageLabel}
            </a>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <InfoNote>
              Tu feedback se guardará como un documento <strong>privado</strong> en Seed dentro de{' '}
              <strong>{targetAccountLabel}</strong>.
            </InfoNote>
            <InfoNote>
              Solo usuarios autenticados con permiso en este sitio pueden enviar feedback desde{' '}
              <strong>{FEEDBACK_ROUTE_PATH}</strong>.
            </InfoNote>
          </div>

          {showAuthGate ? (
            <StateCard
              icon={<Lock className="size-5 text-[#1d9e75]" />}
              title="Inicia sesión para continuar"
              body="Necesitas iniciar sesión en Seed para guardar este feedback como documento privado en este sitio."
            >
              <Button variant="inverse" size="lg" onClick={() => authDialog.createAccount()}>
                Iniciar sesión para continuar
              </Button>
            </StateCard>
          ) : showCapabilityLoading ? (
            <StateCard
              icon={<Spinner />}
              title="Comprobando permisos"
              body="Estamos verificando si tu cuenta puede guardar feedback privado en este sitio."
            />
          ) : showCapabilityError ? (
            <StateCard
              icon={<AlertCircle className="size-5 text-[#b54747]" />}
              title="No puedes enviar feedback en este sitio"
              body="Tu cuenta ha iniciado sesión, pero no tiene permisos para guardar feedback en este sitio."
              tone="error"
            />
          ) : success ? (
            <StateCard
              icon={<Check className="size-5 text-[#1d9e75]" />}
              title="Gracias."
              body={`Tu feedback se ha guardado como documento privado en ${success.privateLabel}.`}
            >
              <p className="text-sm leading-7 text-[#5f5e5a]">Fecha de envío: {success.submittedAt}</p>
              <Button variant="inverse" size="lg" asChild>
                <a href={success.href} target="_blank" rel="noreferrer">
                  Abrir mi documento privado <ArrowUpRight className="size-4" />
                </a>
              </Button>
            </StateCard>
          ) : (
            <form className="flex flex-col gap-8" onSubmit={handleSubmit}>
              <SectionLabel>Tu feedback</SectionLabel>

              <QuestionBlock
                number="1 de 7"
                label="¿Cuál ha sido tu primera impresión? ¿Qué has pensado que era esto?"
                hint="Tu primer instinto, sin filtros"
              >
                <Textarea
                  value={values.firstImpression}
                  onChange={(event) => updateField('firstImpression', event.target.value)}
                  placeholder="Lo primero que pensé fue…"
                  className="min-h-28 rounded-2xl border-[#c5c3ba] bg-[#faf9f5] px-4 py-3 text-sm leading-7 shadow-none focus-visible:border-[#1d9e75] focus-visible:ring-[#1d9e75]/20"
                />
              </QuestionBlock>

              <QuestionBlock number="2 de 7" label="¿Qué has pensado que podías hacer en este site?">
                <Textarea
                  value={values.possibleActions}
                  onChange={(event) => updateField('possibleActions', event.target.value)}
                  placeholder="Pensé que podía…"
                  className="min-h-28 rounded-2xl border-[#c5c3ba] bg-[#faf9f5] px-4 py-3 text-sm leading-7 shadow-none focus-visible:border-[#1d9e75] focus-visible:ring-[#1d9e75]/20"
                />
              </QuestionBlock>

              <QuestionBlock
                number="3 de 7"
                label="Si te interesara mucho un contenido y quisieras hacer un comentario, ¿cómo lo harías?"
                hint="Si te bloqueaste o lo dejaste a medias, eso es exactamente lo que necesitamos saber"
              >
                <Textarea
                  value={values.howToComment}
                  onChange={(event) => updateField('howToComment', event.target.value)}
                  placeholder="Intentaría… / No sé cómo…"
                  className="min-h-28 rounded-2xl border-[#c5c3ba] bg-[#faf9f5] px-4 py-3 text-sm leading-7 shadow-none focus-visible:border-[#1d9e75] focus-visible:ring-[#1d9e75]/20"
                />
              </QuestionBlock>

              <QuestionBlock
                number="4 de 7"
                label="Imagina que lees un párrafo que te parece muy interesante y quieres compartirlo con alguien. ¿Cómo lo harías?"
                hint="No hay respuesta correcta, nos interesa tu intuición"
              >
                <Textarea
                  value={values.howToShare}
                  onChange={(event) => updateField('howToShare', event.target.value)}
                  placeholder="Creo que haría… / Buscaría…"
                  className="min-h-28 rounded-2xl border-[#c5c3ba] bg-[#faf9f5] px-4 py-3 text-sm leading-7 shadow-none focus-visible:border-[#1d9e75] focus-visible:ring-[#1d9e75]/20"
                />
              </QuestionBlock>

              <QuestionBlock
                number="5 de 7"
                label="¿Qué tan claro te quedó para qué sirve esta herramienta?"
                hint="1 = nada claro, 5 = completamente obvio"
              >
                <fieldset>
                  <legend className="sr-only">Claridad</legend>
                  <div className="flex flex-wrap gap-2">
                    {CLARITY_OPTIONS.map((option) => (
                      <ChoicePill
                        key={option}
                        name="clarity"
                        value={option}
                        checked={values.clarity === option}
                        onChange={(value) => updateField('clarity', value)}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex justify-between text-[11px] text-[#888780]">
                    <span>Nada claro</span>
                    <span>Completamente obvio</span>
                  </div>
                </fieldset>
              </QuestionBlock>

              <QuestionBlock number="6 de 7" label="¿Encontraste el botón de comentar?">
                <fieldset>
                  <legend className="sr-only">Botón de comentar</legend>
                  <div className="flex flex-wrap gap-2">
                    {COMMENT_BUTTON_OPTIONS.map((option) => (
                      <ChoicePill
                        key={option}
                        name="comment-button"
                        value={option}
                        checked={values.foundCommentButton === option}
                        onChange={(value) => updateField('foundCommentButton', value)}
                        wide
                      />
                    ))}
                  </div>
                </fieldset>
              </QuestionBlock>

              <QuestionBlock
                number="7 de 7"
                label="Una cosa que cambiarías para que todo tenga más sentido desde el primer momento y te den ganas de interactuar y comentar."
              >
                <Textarea
                  value={values.oneChange}
                  onChange={(event) => updateField('oneChange', event.target.value)}
                  placeholder="Añadiría… / Quitaría… / Lo primero que mostraría es…"
                  className="min-h-28 rounded-2xl border-[#c5c3ba] bg-[#faf9f5] px-4 py-3 text-sm leading-7 shadow-none focus-visible:border-[#1d9e75] focus-visible:ring-[#1d9e75]/20"
                />
              </QuestionBlock>

              <div className="border-t border-[#c5c3ba] pt-8">
                <span className="mb-3 block text-[1.35rem] font-bold text-[#1a1a18]" style={{fontFamily: '"Libre Baskerville", serif'}}>
                  Ya estamos, muchísimas gracias por tu ayuda 🙌
                </span>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    value={values.name}
                    onChange={(event) => updateField('name', event.target.value)}
                    placeholder="Tu nombre (opcional)"
                    className="h-12 rounded-2xl border-[#c5c3ba] bg-[#faf9f5] px-4 text-sm shadow-none focus-visible:border-[#1d9e75] focus-visible:ring-[#1d9e75]/20"
                  />
                  <Input
                    value={values.email}
                    onChange={(event) => updateField('email', event.target.value)}
                    placeholder="Tu email — si quieres que te contactemos (opcional)"
                    className="h-12 rounded-2xl border-[#c5c3ba] bg-[#faf9f5] px-4 text-sm shadow-none focus-visible:border-[#1d9e75] focus-visible:ring-[#1d9e75]/20"
                  />
                </div>
                <p className="mt-3 text-[11px] leading-5 text-[#888780]">
                  Ambos campos son opcionales. Lo importante es tu feedback, y puede ser parcial si así te sale más
                  natural.
                </p>
                {formError ? <ErrorBanner>{formError}</ErrorBanner> : null}
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="max-w-xl text-sm leading-7 text-[#5f5e5a]">
                    Al enviar, guardarás un documento privado en <strong>{targetAccountLabel}</strong>.
                  </p>
                  <Button
                    type="submit"
                    variant="inverse"
                    size="lg"
                    disabled={submitDisabled}
                    className="rounded-full px-6"
                  >
                    {submitDisabled ? (
                      <>
                        <Spinner /> Guardando…
                      </>
                    ) : (
                      'Enviar mi feedback →'
                    )}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionLabel({children}: {children: ReactNode}) {
  return (
    <div className="flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.16em] text-[#888780]">
      <span>{children}</span>
      <span className="h-px flex-1 bg-[#c5c3ba]" />
    </div>
  )
}

function QuestionBlock({
  number,
  label,
  hint,
  children,
}: {
  number: string
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <p className="text-[11px] text-[#888780]">{number}</p>
      <h2 className="text-base leading-7 text-[#1a1a18]" style={{fontFamily: '"Libre Baskerville", serif'}}>
        {label}
      </h2>
      {hint ? <p className="text-xs text-[#888780]">{hint}</p> : null}
      {children}
    </section>
  )
}

function ChoicePill({
  name,
  value,
  checked,
  onChange,
  wide = false,
}: {
  name: string
  value: string
  checked: boolean
  onChange: (value: string) => void
  wide?: boolean
}) {
  return (
    <label className={cn('inline-flex', wide && 'min-w-[140px]')}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={(event) => onChange(event.target.value)}
        className="peer sr-only"
      />
      <span
        className={cn(
          'flex h-11 items-center justify-center rounded-2xl border border-[#c5c3ba] bg-[#faf9f5] px-4 text-sm text-[#5f5e5a] transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-[#1d9e75]/40 peer-checked:border-[#1d9e75] peer-checked:bg-[#1d9e75] peer-checked:text-white',
          wide ? 'w-full' : 'min-w-11',
        )}
      >
        {value}
      </span>
    </label>
  )
}

function InfoNote({children}: {children: ReactNode}) {
  return (
    <div className="rounded-2xl border border-white/60 bg-white/55 px-4 py-4 text-sm leading-7 text-[#3b3a36] backdrop-blur">
      {children}
    </div>
  )
}

function ErrorBanner({children}: {children: ReactNode}) {
  return (
    <div className="mt-5 rounded-2xl border border-[#e4b7b7] bg-[#fff6f6] px-4 py-3 text-sm text-[#8f3838]">{children}</div>
  )
}

function StateCard({
  icon,
  title,
  body,
  children,
  tone = 'default',
}: {
  icon: ReactNode
  title: string
  body: string
  children?: ReactNode
  tone?: 'default' | 'error'
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-4 rounded-[24px] border px-6 py-10 text-center shadow-[0_16px_40px_rgba(49,47,38,0.05)]',
        tone === 'error' ? 'border-[#ecc9c9] bg-[#fff8f8]' : 'border-[#d3d1c7] bg-white',
      )}
    >
      <div
        className={cn('flex size-12 items-center justify-center rounded-full', tone === 'error' ? 'bg-[#fdeaea]' : 'bg-[#e1f5ee]')}
      >
        {icon}
      </div>
      <div className="space-y-2">
        <h2 className="text-[1.55rem] text-[#1a1a18]" style={{fontFamily: '"Libre Baskerville", serif'}}>
          {title}
        </h2>
        <p className="max-w-xl text-sm leading-7 text-[#5f5e5a]">{body}</p>
      </div>
      {children ? <div className="flex flex-col items-center gap-3">{children}</div> : null}
    </div>
  )
}
