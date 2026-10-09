/**
 * A loopback Datalab for tests: records every submission and answers the check URL the way the
 * real API does (`processing` until `complete`), with knobs for rate limits, failures and stalls.
 */

/** Behaviour knobs for one fake server. */
export type FakeDatalabOptions = {
  /** How many polls answer `processing` before `complete`. */
  processingPolls?: number
  /** HTTP statuses forced on the first submits, e.g. `[429]`; later submits behave normally. */
  submitStatuses?: number[]
  /** Final poll bodies in submission order; the last one repeats. */
  completions?: Record<string, unknown>[]
  /** Every poll says processing, forever. */
  neverComplete?: boolean
}

/** What the fake saw for one submitted document. */
export type FakeDatalabSubmission = {
  fields: Record<string, string>
  fileName: string
  fileType: string
  fileBytes: number
  apiKey: string | null
}

/** Completion the fake answers when a test gives none: a short document with two images. */
export const FAKE_DATALAB_COMPLETION = {
  status: 'complete',
  success: true,
  markdown: '# Title\n\nText ![Figure 1](fig1.png) more text.\n\n![](_page_0_Picture_2.jpeg)\n',
  images: {
    'fig1.png': Buffer.from('PNGDATA').toString('base64'),
    '_page_0_Picture_2.jpeg': Buffer.from('JPG').toString('base64'),
  },
  page_count: 3,
  parse_quality_score: 4.5,
  cost_breakdown: {total_cost: 1.2},
}

/** Starts the fake on a random loopback port. Stop it in `finally`. */
export function startFakeDatalab(options: FakeDatalabOptions = {}) {
  const submissions: FakeDatalabSubmission[] = []
  const pollKeys: (string | null)[] = []
  let polls = 0
  let submitCount = 0
  let inFlight = 0
  let peakInFlight = 0
  let port = 0
  const server = Bun.serve({
    port: 0,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url)
      if (req.method === 'POST' && url.pathname === '/convert') {
        const forced = options.submitStatuses?.[submitCount++]
        if (forced !== undefined) return Response.json({error: 'slow down'}, {status: forced})
        const form = await req.formData()
        const fields: Record<string, string> = {}
        let fileName = ''
        let fileType = ''
        let fileBytes = 0
        for (const [key, value] of form.entries()) {
          const part: unknown = value
          if (part instanceof File) {
            fileName = part.name
            fileType = part.type
            fileBytes = part.size
          } else fields[key] = String(value)
        }
        submissions.push({fields, fileName, fileType, fileBytes, apiKey: req.headers.get('x-api-key')})
        inFlight++
        peakInFlight = Math.max(peakInFlight, inFlight)
        const id = `req-${submissions.length}`
        return Response.json({
          success: true,
          request_id: id,
          request_check_url: `http://127.0.0.1:${port}/convert/${id}`,
        })
      }
      if (req.method === 'GET' && url.pathname.startsWith('/convert/')) {
        pollKeys.push(req.headers.get('x-api-key'))
        polls++
        if (options.neverComplete || polls <= (options.processingPolls ?? 0)) {
          return Response.json({status: 'processing', success: null})
        }
        const completions = options.completions ?? [FAKE_DATALAB_COMPLETION]
        const requestIndex = Number(url.pathname.slice('/convert/req-'.length)) - 1
        const body = completions[Math.min(Math.max(requestIndex, 0), completions.length - 1)]!
        inFlight = Math.max(0, inFlight - 1)
        return Response.json(body)
      }
      return new Response('not found', {status: 404})
    },
  })
  port = server.port ?? 0
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    submissions,
    pollKeys,
    get polls() {
      return polls
    },
    get peakInFlight() {
      return peakInFlight
    },
    stop: () => server.stop(true),
  }
}
