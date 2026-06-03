import {describe, expect, it, vi} from 'vitest'

vi.mock('@seed-hypermedia/client', () => ({
  signDocumentChange: vi.fn(async () => ({
    changeCid: {toString: () => 'bafy-feedback-version'},
    publishInput: {blobs: [{cid: 'bafy-feedback-version', data: new Uint8Array([1])}]},
  })),
}))

import {
  buildFeedbackDocumentMarkdown,
  buildFeedbackDocumentTitle,
  formatFeedbackTimestamp,
  hasMeaningfulFeedback,
  normalizeFeedbackFormValues,
  publishFeedbackDocument,
  type FeedbackFormValues,
} from './feedback'

function makeValues(overrides: Partial<FeedbackFormValues> = {}): FeedbackFormValues {
  return {
    name: '',
    email: '',
    firstImpression: '',
    possibleActions: '',
    howToComment: '',
    howToShare: '',
    clarity: '',
    foundCommentButton: '',
    oneChange: '',
    ...overrides,
  }
}

describe('feedback helpers', () => {
  it('normalizes free-text fields at submit boundaries', () => {
    expect(
      normalizeFeedbackFormValues(
        makeValues({
          name: '  Ada  ',
          email: '  ada@example.com ',
          firstImpression: '  unclear but interesting  ',
        }),
      ),
    ).toMatchObject({
      name: 'Ada',
      email: 'ada@example.com',
      firstImpression: 'unclear but interesting',
    })
  })

  it('requires a real feedback field instead of name/email only', () => {
    expect(hasMeaningfulFeedback(makeValues({name: 'Ada', email: 'ada@example.com'}))).toBe(false)
    expect(hasMeaningfulFeedback(makeValues({clarity: '4'}))).toBe(true)
  })

  it('formats timestamps and titles consistently', () => {
    const submittedAt = formatFeedbackTimestamp(new Date(2026, 4, 28, 14, 32))
    expect(submittedAt).toBe('2026-05-28 14:32')
    expect(buildFeedbackDocumentTitle(submittedAt, 'nodosdeconocimiento.es')).toBe(
      'Feedback on nodosdeconocimiento.es — 2026-05-28 14:32',
    )
  })

  it('builds markdown with context markers and omits empty sections', () => {
    const markdown = buildFeedbackDocumentMarkdown(
      makeValues({
        firstImpression: 'Me pareció una biblioteca viva.',
        clarity: '4 / 5',
      }),
      {
        submittedAt: '2026-05-28 14:32',
        publishedUnderLabel: 'Ethosfera',
        publishedUnderAccountUid: 'z6MkSite',
        testedPageLabel: 'nodosdeconocimiento.es',
        testedPageUrl: 'https://nodosdeconocimiento.es',
        visibilityLabel: 'Privado',
      },
    )

    expect(markdown).toContain('Feedback enviado mediante formulario web.')
    expect(markdown).toContain('- Formulario: /feedback')
    expect(markdown).toContain('- Página evaluada: nodosdeconocimiento.es')
    expect(markdown).toContain('- URL: https://nodosdeconocimiento.es')
    expect(markdown).toContain('- Sitio participante: Ethosfera')
    expect(markdown).toContain('- Cuenta de destino: z6MkSite')
    expect(markdown).toContain('## Primera impresión')
    expect(markdown).toContain('## Qué tan claro quedó para qué sirve')
    expect(markdown).not.toContain('## Nombre')
    expect(markdown).not.toContain('## Email')
  })

  it('publishes a private feedback document with the generated path and capability', async () => {
    const request = vi.fn(async (_method: string, _payload: unknown) => ({unsignedChange: new Uint8Array([1, 2, 3])}))
    const publish = vi.fn(async (_input: {blobs: Array<{cid?: string; data: Uint8Array}>}) => ({cids: []}))
    const signer = {
      getPublicKey: vi.fn(async () => new Uint8Array([1, 2, 3])),
      sign: vi.fn(async () => new Uint8Array(64)),
    }

    const result = await publishFeedbackDocument(
      {
        request: request as any,
        publish,
        getSigner: () => signer,
        generatePath: () => 'private-feedback-path',
        now: () => new Date(2026, 4, 28, 14, 32),
      },
      makeValues({firstImpression: 'Muy interesante'}),
      {
        publishAccountUid: 'site-uid',
        signingAccountUid: 'delegated-user',
        capabilityCid: 'cap-123',
        publishedUnderLabel: 'Ethosfera',
        publishedUnderAccountUid: 'site-uid',
        testedPageLabel: 'nodosdeconocimiento.es',
        testedPageUrl: 'https://nodosdeconocimiento.es',
      },
    )

    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]?.[0]).toBe('PrepareDocumentChange')
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      account: 'site-uid',
      path: '/private-feedback-path',
      capability: 'cap-123',
      visibility: 2,
    })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(result.documentId.uid).toBe('site-uid')
    expect(result.documentId.path).toEqual(['private-feedback-path'])
    expect(result.documentId.version).toBe('bafy-feedback-version')
    expect(result.title).toContain('Feedback on nodosdeconocimiento.es')
  })
})
