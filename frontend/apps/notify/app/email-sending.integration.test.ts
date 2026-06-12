import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {resolveContentReferenceNames} from './email-notifier'

const {createTransportMock, sendMailMock} = vi.hoisted(() => {
  const sendMailMock = vi.fn()
  const createTransportMock = vi.fn(() => ({
    sendMail: sendMailMock,
  }))
  return {createTransportMock, sendMailMock}
})

vi.mock('nodemailer', () => ({
  default: {
    createTransport: createTransportMock,
  },
}))

describe('notification email sending integration', () => {
  beforeEach(() => {
    vi.resetModules()
    createTransportMock.mockClear()
    sendMailMock.mockReset()
    sendMailMock.mockResolvedValue({messageId: 'test-message-id'})

    process.env.NOTIFY_SMTP_HOST = 'smtp.example.com'
    process.env.NOTIFY_SMTP_PORT = '465'
    process.env.NOTIFY_SMTP_USER = 'notify@example.com'
    process.env.NOTIFY_SMTP_PASSWORD = 'secret'
    process.env.NOTIFY_SENDER = 'Seed <notify@example.com>'
  })

  afterEach(() => {
    delete process.env.NOTIFY_SMTP_HOST
    delete process.env.NOTIFY_SMTP_PORT
    delete process.env.NOTIFY_SMTP_USER
    delete process.env.NOTIFY_SMTP_PASSWORD
    delete process.env.NOTIFY_SENDER
  })

  it('sends a mention email with resolved document and profile names instead of raw hm ids', async () => {
    const commentBlocks: HMBlockNode[] = [
      {
        block: {
          id: 'block-1',
          type: 'Paragraph',
          text: '\uFFFC can you review \uFFFC?',
          annotations: [
            {
              type: 'Embed',
              link: 'hm://alice/:profile',
              starts: [0],
              ends: [1],
            },
            {
              type: 'Embed',
              link: 'hm://doc-owner/projects/roadmap',
              starts: [17],
              ends: [18],
            },
          ],
        } as any,
        children: [],
      },
    ]

    const resolvedNames = await resolveContentReferenceNames(commentBlocks, async (id) => {
      if (id.uid === 'doc-owner' && id.path?.join('/') === 'projects/roadmap') return 'Roadmap'
      if (id.uid === 'alice' && id.path?.[0] === ':profile') return 'Alice'
      return null
    })

    const [{createMentionEmail}, {sendEmail}] = await Promise.all([import('@shm/emails/notifier'), import('./mailer')])

    const mentionEmail = await createMentionEmail({
      authorName: 'Eric',
      subjectName: 'you',
      documentName: 'Design Notes',
      commentBlocks,
      actionUrl: 'https://hyper.media/hm/doc-owner/projects/roadmap?comment=1',
      unsubscribeUrl: 'https://notify.example.com/hm/api/unsubscribe?token=test-token',
      siteUrl: 'https://hyper.media',
      resolvedNames,
    })

    await sendEmail(
      'reader@example.com',
      mentionEmail.subject,
      {text: mentionEmail.text, html: mentionEmail.html},
      undefined,
      {
        unsubscribeUrl: 'https://notify.example.com/hm/api/unsubscribe?token=test-token',
        feedbackId: 'mention',
      },
    )

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 465,
        auth: {
          user: 'notify@example.com',
          pass: 'secret',
        },
      }),
    )
    expect(sendMailMock).toHaveBeenCalledTimes(1)

    const sentMessage = sendMailMock.mock.calls[0]?.[0]
    expect(sentMessage).toMatchObject({
      from: 'Seed <notify@example.com>',
      to: 'reader@example.com',
      subject: 'Eric mentioned you in a comment on Design Notes',
      headers: expect.objectContaining({
        'List-Unsubscribe': '<https://notify.example.com/hm/api/unsubscribe?token=test-token>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'Feedback-Id': 'mention:seed-notify',
      }),
    })
    expect(sentMessage.html).toContain('Roadmap')
    expect(sentMessage.html).toContain('Alice')
    expect(sentMessage.html).not.toContain('@Roadmap')
    expect(sentMessage.html).not.toContain('@Alice')
    expect(sentMessage.html).not.toContain('hm://doc-owner/projects/roadmap')
    expect(sentMessage.html).not.toContain('hm://alice/:profile')
    expect(sentMessage.html).not.toContain('\uFFFC')
  })
})
