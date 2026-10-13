import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const {createTransportMock, sendMailMock} = vi.hoisted(() => {
  const sendMailMock = vi.fn()
  const createTransportMock = vi.fn(() => ({sendMail: sendMailMock}))
  return {createTransportMock, sendMailMock}
})

vi.mock('nodemailer', () => ({default: {createTransport: createTransportMock}}))

const ENV_KEYS = [
  'NOTIFY_SMTP_HOST',
  'NOTIFY_SMTP_PORT',
  'NOTIFY_SMTP_USER',
  'NOTIFY_SMTP_PASSWORD',
  'NOTIFY_SENDER',
  'NOTIFY_EMAIL_RELAY_URL',
  'NOTIFY_EMAIL_RELAY_TOKEN',
] as const

const RELAY_URL = 'https://host.example.com/api/email-relay'
const RELAY_TOKEN = 'relay-token-123'

function setSmtpEnv() {
  process.env.NOTIFY_SMTP_HOST = 'smtp.example.com'
  process.env.NOTIFY_SMTP_PORT = '465'
  process.env.NOTIFY_SMTP_USER = 'notify@example.com'
  process.env.NOTIFY_SMTP_PASSWORD = 'secret'
  process.env.NOTIFY_SENDER = 'Seed <notify@example.com>'
}

function setRelayEnv() {
  process.env.NOTIFY_EMAIL_RELAY_URL = RELAY_URL
  process.env.NOTIFY_EMAIL_RELAY_TOKEN = RELAY_TOKEN
}

describe('mailer', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.resetModules()
    createTransportMock.mockClear()
    sendMailMock.mockReset()
    sendMailMock.mockResolvedValue({messageId: 'smtp-message-id'})
    fetchMock.mockReset()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    for (const key of ENV_KEYS) delete process.env[key]
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    for (const key of ENV_KEYS) delete process.env[key]
  })

  it('posts the message to the relay with the bearer token when a relay is configured', async () => {
    setRelayEnv()
    fetchMock.mockResolvedValue(new Response(null, {status: 202}))
    const {sendEmail} = await import('./mailer')

    await sendEmail('alice@acme.org', 'You were mentioned', {text: 'plain body', html: '<p>html body</p>'}, 'Eric', {
      unsubscribeUrl: 'https://notify.acme.org/unsub',
    })

    expect(createTransportMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(RELAY_URL)
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${RELAY_TOKEN}`)
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(init?.body as string)).toEqual({
      to: 'alice@acme.org',
      subject: 'You were mentioned',
      text: 'plain body',
      html: '<p>html body</p>',
    })
  })

  it('leaves html out of the relay body when there is none', async () => {
    setRelayEnv()
    fetchMock.mockResolvedValue(new Response(null, {status: 202}))
    const {sendEmail} = await import('./mailer')

    await sendEmail('alice@acme.org', 'Subject', {text: 'only text'})

    expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toEqual({
      to: 'alice@acme.org',
      subject: 'Subject',
      text: 'only text',
    })
  })

  it('turns a 401 from the relay into an error that does not carry the token', async () => {
    setRelayEnv()
    fetchMock.mockResolvedValue(new Response('{"message":"Unauthorized"}', {status: 401}))
    const {sendEmail} = await import('./mailer')

    const error = await sendEmail('alice@acme.org', 'Subject', {text: 'x'}).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/HTTP 401/)
    expect((error as Error).message).not.toContain(RELAY_TOKEN)
  })

  it('reports a relay that cannot be reached', async () => {
    setRelayEnv()
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const {sendEmail} = await import('./mailer')

    await expect(sendEmail('alice@acme.org', 'Subject', {text: 'x'})).rejects.toThrow(/unreachable: ECONNREFUSED/)
  })

  it('prefers the relay over SMTP when both are configured', async () => {
    setSmtpEnv()
    setRelayEnv()
    fetchMock.mockResolvedValue(new Response(null, {status: 202}))
    const {sendEmail} = await import('./mailer')

    await sendEmail('alice@acme.org', 'Subject', {text: 'x'})

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(createTransportMock).not.toHaveBeenCalled()
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('keeps sending over SMTP when only SMTP is configured', async () => {
    setSmtpEnv()
    const {sendEmail} = await import('./mailer')

    const info = await sendEmail('alice@acme.org', 'Subject', {text: 'x', html: '<p>x</p>'}, 'Eric')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({host: 'smtp.example.com', port: 465}))
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({from: 'Eric <notify@example.com>', to: 'alice@acme.org', subject: 'Subject'}),
    )
    expect(info).toEqual({messageId: 'smtp-message-id'})
  })

  it('a relay without a token does not count: SMTP is still used', async () => {
    setSmtpEnv()
    process.env.NOTIFY_EMAIL_RELAY_URL = RELAY_URL
    const {sendEmail} = await import('./mailer')

    await sendEmail('alice@acme.org', 'Subject', {text: 'x'})

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sendMailMock).toHaveBeenCalledTimes(1)
  })

  it('logs and drops the email when neither relay nor SMTP is configured', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const {sendEmail} = await import('./mailer')

    const result = await sendEmail('alice@acme.org', 'Subject', {text: 'x'})

    expect(result).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createTransportMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Email notifier is not enabled'))
    errorSpy.mockRestore()
  })
})
