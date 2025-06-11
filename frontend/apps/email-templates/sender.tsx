import dotenv from 'dotenv'
import fs from 'fs'
import nodemailer from 'nodemailer'
import {createNotificationsEmail} from './notifier'

dotenv.config()

const transporter = nodemailer.createTransport({
  host: process.env.NOTIFY_SMTP_HOST,
  port: Number(process.env.NOTIFY_SMTP_PORT),
  auth: {
    user: process.env.NOTIFY_SMTP_USER,
    pass: process.env.NOTIFY_SMTP_PASSWORD,
  },
})

export async function sendEmail(
  to: string,
  subject: string,
  body: {text: string; html?: string},
  senderLabel?: string,
) {
  if (!transporter) {
    console.error('Email notifier is not enabled')
    return
  }
  // console.log(`Sending email to ${to} with subject ${subject}`)

  const from = senderLabel
    ? `${senderLabel} <${process.env.NOTIFY_SMTP_USER}>`
    : process.env.NOTIFY_SENDER

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text: body.text,
    html: body.html,
  })

  return info
}

export const sendNotificationsEmail = async () => {
  const {email, opts, notifications} = JSON.parse(
    fs.readFileSync('./mock-notification3.json', 'utf-8'),
  )

  const {subject, text, html, subscriberNames} = await createNotificationsEmail(
    email,
    opts,
    notifications,
  )

  await sendEmail(
    email,
    subject,
    {text, html},
    `Hypermedia Updates for ${Array.from(subscriberNames).join(', ')}`,
  )
}
