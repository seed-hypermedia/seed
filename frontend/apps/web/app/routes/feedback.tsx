import {
  FEEDBACK_CONFIG,
  FEEDBACK_ROUTE_PATH,
  type FeedbackFormValues,
  hasMeaningfulFeedback,
  normalizeFeedbackFormValues,
} from '@/feedback'
import {loadSiteHeaderData, type SiteHeaderPayload} from '@/loaders'
import {defaultSiteIcon} from '@/meta'
import {PageFooter} from '@/page-footer'
import {getOptimizedImageUrl, NavigationLoadingContent, WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {reportError} from '@/report-error'
import {getConfig} from '@/site-config.server'
import {WebSiteHeader} from '@/web-site-header'
import {unwrap} from '@/wrapping'
import {wrapJSON} from '@/wrapping.server'
import {getDaemonAuthToken, withDaemonAuthToken} from '@/daemon-auth.server'
import {LoaderFunctionArgs, LinksFunction, MetaFunction} from '@remix-run/node'
import {MetaDescriptor, useLoaderData} from '@remix-run/react'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Textarea} from '@shm/ui/components/textarea'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {Spinner} from '@shm/ui/spinner'
import {cn} from '@shm/ui/utils'
import {useMutation} from '@tanstack/react-query'
import {Check} from 'lucide-react'
import type {FormEvent, ReactNode} from 'react'
import {useState} from 'react'

type FeedbackPagePayload = SiteHeaderPayload & {
  feedbackDestinationLabel: string | null
}

type PublishSuccessState = {
  destinationLabel: string
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
    const [headerData, config] = await Promise.all([
      loadSiteHeaderData(parsedRequest),
      getConfig(parsedRequest.hostname),
    ])
    return wrapJSON({
      ...headerData,
      feedbackDestinationLabel: config?.feedbackDestinationLabel?.trim() || null,
    } satisfies FeedbackPagePayload)
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
  const {homeMetadata, siteHost} = unwrap<FeedbackPagePayload>(data)
  const meta: MetaDescriptor[] = []
  const homeIconCid = homeMetadata?.icon ? extractIpfsUrlCid(homeMetadata.icon) : null
  const homeIcon = homeIconCid ? getOptimizedImageUrl(homeIconCid, 'S') : null
  const pageLabel = homeMetadata?.name?.trim() || new URL(siteHost).host
  meta.push({
    tagName: 'link',
    rel: 'icon',
    href: homeIcon || defaultSiteIcon,
    type: 'image/png',
  })
  meta.push({title: `${FEEDBACK_CONFIG.pageTitle} on ${pageLabel}`})
  return meta
}

export default function FeedbackRoute() {
  const {originHomeId, siteHost, origin, homeMetadata, dehydratedState, feedbackDestinationLabel} =
    unwrap<FeedbackPagePayload>(useLoaderData())
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
        <NavigationLoadingContent className="flex w-full max-w-5xl flex-1 flex-col px-4 pt-[var(--site-header-h)] pb-16 sm:pt-0">
          <FeedbackPageBody
            originHomeId={originHomeId}
            homeMetadata={homeMetadata}
            siteOrigin={origin}
            feedbackDestinationLabel={feedbackDestinationLabel}
          />
        </NavigationLoadingContent>
        <PageFooter className="w-full" hideDeviceLinkToast />
      </div>
    </WebSiteProvider>
  )
}

function FeedbackPageBody({
  originHomeId,
  homeMetadata,
  siteOrigin,
  feedbackDestinationLabel,
}: {
  originHomeId: NonNullable<FeedbackPagePayload['originHomeId']>
  homeMetadata: FeedbackPagePayload['homeMetadata']
  siteOrigin: string
  feedbackDestinationLabel: string | null
}) {
  const [values, setValues] = useState<FeedbackFormValues>(INITIAL_VALUES)
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState<PublishSuccessState | null>(null)

  const siteName = homeMetadata?.name?.trim() || new URL(siteOrigin).host
  const testedPageLabel = new URL(siteOrigin).host
  const testedPageUrl = siteOrigin
  const logoCid = homeMetadata?.icon ? extractIpfsUrlCid(homeMetadata.icon) : null
  const logoSrc = logoCid ? getOptimizedImageUrl(logoCid, 'M') : null

  const submitFeedback = useMutation({
    mutationFn: async (normalizedValues: FeedbackFormValues) => {
      const response = await fetch('/hm/api/feedback', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(normalizedValues),
      })
      if (!response.ok) {
        throw new Error(`Feedback submit failed with status ${response.status}`)
      }
      return (await response.json()) as {destinationLabel: string; submittedAt: string}
    },
    onSuccess: (result) => {
      setSuccess({
        destinationLabel: result.destinationLabel,
        submittedAt: result.submittedAt,
      })
      setFormError(null)
    },
    onError: (error) => {
      reportError(error, {
        feature: 'feedback',
        operation: 'submit-feedback',
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

  return (
    <div className="mx-auto w-full max-w-3xl py-10 text-[#1a1a18]" style={{fontFamily: '"DM Sans", sans-serif'}}>
      <div className="relative overflow-hidden rounded-[28px] border border-[#d3d1c7] bg-[#f0ede4] px-6 py-8 shadow-[0_24px_80px_rgba(46,46,35,0.08)] sm:px-10 sm:py-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.65),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(29,158,117,0.08),transparent_32%)]" />
        {logoSrc ? (
          <div className="absolute top-6 right-6 z-10 size-11 overflow-hidden rounded-full border border-white/60 shadow-sm">
            <img src={logoSrc} alt={siteName} className="size-full object-cover" />
          </div>
        ) : null}

        <div className="relative z-10 flex flex-col gap-8">
          <header className="max-w-2xl">
            <p className="mb-4 text-[11px] font-medium tracking-[0.18em] text-[#888780] uppercase">Feedback privado</p>
            <h1
              className="text-[2.35rem] leading-[1.08] text-[#1a1a18] sm:text-[2.8rem]"
              style={{fontFamily: '"Libre Baskerville", serif'}}
            >
              Ayúdanos a mejorar
              <br />
              <span className="text-[#1d9e75] italic">compartiendo tu feedback</span>
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-[#5f5e5a]">
              Estamos construyendo un lugar para crear conocimiento, leer, comentar y conectar — sin un servidor central
              que lo controle.
              <span className="mt-2 block">Este test dura unos 8–10 minutos, muchas gracias por tu tiempo.</span>
            </p>
          </header>

          <div className="rounded-2xl border border-l-[3px] border-[#d3d1c7] border-l-[#1d9e75] bg-white px-5 py-5 shadow-[0_10px_30px_rgba(49,47,38,0.03)]">
            <span className="mb-3 block text-[13px] font-medium tracking-[0.08em] text-[#1d9e75] uppercase">
              Tu tarea
            </span>
            <p className="mb-3 text-sm leading-7 text-[#2c2c2a]">
              Vuelve a la portada del sitio, echa un vistazo a lo que ves durante un par de minutos y lee lo que te
              llame la atención. A continuación responde a las preguntas.
            </p>
            <p className="mb-4 text-sm leading-7 text-[#2c2c2a]">
              No te preocupes por hacerlo “bien” — tu confusión es el feedback más valioso que podemos recibir.
            </p>
            <a
              href={testedPageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-[#1d9e75] underline underline-offset-4"
            >
              ↗ Abrir {testedPageLabel}
            </a>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <InfoNote>
              Tu feedback se enviará al equipo y se guardará como un documento <strong>privado</strong> en{' '}
              <strong>{feedbackDestinationLabel || 'Seed Surveys'}</strong>.
            </InfoNote>
            <InfoNote>
              No necesitas permisos de escritura en el destino. El servidor guardará el feedback de forma segura desde{' '}
              <strong>{FEEDBACK_ROUTE_PATH}</strong>.
            </InfoNote>
          </div>

          {success ? (
            <StateCard
              icon={<Check className="size-5 text-[#1d9e75]" />}
              title="Gracias."
              body={`Tu feedback se ha guardado como documento privado en ${success.destinationLabel}.`}
            >
              <p className="text-sm leading-7 text-[#5f5e5a]">Fecha de envío: {success.submittedAt}</p>
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
                <span
                  className="mb-3 block text-[1.35rem] font-bold text-[#1a1a18]"
                  style={{fontFamily: '"Libre Baskerville", serif'}}
                >
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
                    Al enviar, el servidor guardará tu feedback privado en{' '}
                    <strong>{feedbackDestinationLabel || 'Seed Surveys'}</strong>.
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
    <div className="flex items-center gap-3 text-[10px] font-medium tracking-[0.16em] text-[#888780] uppercase">
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
          'flex h-11 items-center justify-center rounded-2xl border border-[#c5c3ba] bg-[#faf9f5] px-4 text-sm text-[#5f5e5a] transition-all peer-checked:border-[#1d9e75] peer-checked:bg-[#1d9e75] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-[#1d9e75]/40',
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
    <div className="mt-5 rounded-2xl border border-[#e4b7b7] bg-[#fff6f6] px-4 py-3 text-sm text-[#8f3838]">
      {children}
    </div>
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
        className={cn(
          'flex size-12 items-center justify-center rounded-full',
          tone === 'error' ? 'bg-[#fdeaea]' : 'bg-[#e1f5ee]',
        )}
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
