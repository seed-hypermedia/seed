import * as email from '@/email'
import {describe, expect, test} from 'bun:test'

type Call = {url: string; init: RequestInit}

/** A fetch that answers from a queue and records every call. */
function fakeFetch(answers: Array<Response | Error>) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({url, init})
    const next = answers.shift()
    if (!next) throw new Error('no more answers')
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof fetch
  return {fetchImpl, calls}
}

const relay = {url: 'https://host.example.com/api/email-relay', token: 'relay-token-123'}

describe('RelaySender', () => {
  test('posts the verification email as JSON with the bearer token and no From', async () => {
    const {fetchImpl, calls} = fakeFetch([new Response(null, {status: 202})])
    const sender = new email.RelaySender(relay, 'https://seed.acme.org', fetchImpl)

    await sender.sendVerificationEmail('alice@acme.org', '1234')

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(relay.url)
    expect(calls[0]!.init.method).toBe('POST')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer relay-token-123')
    expect(headers['content-type']).toBe('application/json')
    const body = JSON.parse(calls[0]!.init.body as string)
    expect(Object.keys(body).sort()).toEqual(['html', 'subject', 'text', 'to'])
    expect(body.to).toBe('alice@acme.org')
    expect(body.subject).toBe('Your verification code for Seed Hypermedia')
    expect(body.text).toContain('1234')
    expect(body.html).toContain('1234')
    expect(body.html).toContain('https://seed.acme.org/email-logo.png')
    expect(body.from).toBeUndefined()
  })

  test('posts the invitation email with the link, the site name and the role', async () => {
    const {fetchImpl, calls} = fakeFetch([new Response(null, {status: 202})])
    const sender = new email.RelaySender(relay, 'https://seed.acme.org', fetchImpl)

    await sender.sendInvitationEmail(
      'carol@acme.org',
      'https://seed.acme.org/vault?invite=abc&email=carol%40acme.org',
      {
        siteName: 'Acme',
        role: 'writer',
      },
    )

    const body = JSON.parse(calls[0]!.init.body as string)
    expect(body.to).toBe('carol@acme.org')
    expect(body.subject).toBe("You're invited to Acme")
    expect(body.text).toContain('https://seed.acme.org/vault?invite=abc&email=carol%40acme.org')
    expect(body.text).toContain('read and edit')
    expect(body.html).toContain('invite=abc&amp;email=carol%40acme.org')
    expect(body.html).toContain('https://seed.acme.org/email-logo.png')
  })

  test('passes replyTo through and leaves html out when absent', async () => {
    const {fetchImpl, calls} = fakeFetch([new Response(null, {status: 202})])
    const sender = new email.RelaySender(relay, '', fetchImpl)

    await sender.send({to: 'bob@acme.org', subject: 'Hi', text: 'plain', replyTo: 'ops@acme.org'})

    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      to: 'bob@acme.org',
      subject: 'Hi',
      text: 'plain',
      replyTo: 'ops@acme.org',
    })
  })

  test('a 401 surfaces as an error that names the status, not the token', async () => {
    const {fetchImpl} = fakeFetch([new Response('{"message":"Unauthorized"}', {status: 401})])
    const sender = new email.RelaySender(relay, '', fetchImpl)

    const error = await sender.sendVerificationEmail('alice@acme.org', '1234').catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/HTTP 401/)
    expect((error as Error).message).not.toContain(relay.token)
  })

  test('a 429 and a network failure are errors too', async () => {
    const rateLimited = new email.RelaySender(
      relay,
      '',
      fakeFetch([new Response('slow down', {status: 429})]).fetchImpl,
    )
    await expect(rateLimited.sendVerificationEmail('a@b.c', '0000')).rejects.toThrow(/HTTP 429 slow down/)

    const offline = new email.RelaySender(relay, '', fakeFetch([new Error('ECONNREFUSED')]).fetchImpl)
    await expect(offline.sendVerificationEmail('a@b.c', '0000')).rejects.toThrow(/unreachable: ECONNREFUSED/)
  })
})

describe('createSender', () => {
  const smtp = {host: 'smtp.example.org', port: 587, user: 'u', password: 'p', sender: 'Seed <seed@example.org>'}

  test('prefers the relay over SMTP', () => {
    const sender = email.createSender({smtp, relay, webBaseUrl: ''})
    expect(sender).toBeInstanceOf(email.RelaySender)
  })

  test('uses SMTP when there is no relay', () => {
    const sender = email.createSender({smtp, relay: null, webBaseUrl: ''})
    expect(sender).not.toBeInstanceOf(email.RelaySender)
    expect(sender.constructor.name).toBe('SmtpSender')
  })

  test('falls back to the console sender when neither is configured', () => {
    const sender = email.createSender({smtp: null, relay: null, webBaseUrl: ''})
    expect(sender.constructor.name).toBe('ConsoleSender')
  })
})
