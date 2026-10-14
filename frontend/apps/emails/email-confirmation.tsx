import {Mjml, MjmlColumn, MjmlPreview, MjmlSection, MjmlText, MjmlTitle} from '@faire/mjml-react'
import {EmailFooter} from './components/EmailFooter'
import {EmailHeader} from './components/EmailHeader'
import {EmailBody, EmailButton, emailTheme} from './components/EmailLayout'
import {EmailHeadDefaults, renderReactToMjml} from './notifier'

export type LoginConfirmationEmailProps = {
  loginUrl: string
  recipientName?: string
}

/** Build the login link email matching the "New sign-in" design. */
export async function createLoginConfirmationEmail({loginUrl, recipientName}: LoginConfirmationEmailProps) {
  const subject = 'New sign-in to your account'
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hi there,'
  const text = `${subject}

${greeting}

We detected a new sign-in to your Seed Hypermedia. This is your login link.

${loginUrl}

If you don't recognise this activity, please change your password immediately.
This link will expire in 15 minutes.`

  const {html} = await renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>A new sign-in was detected on your Seed Hypermedia account</MjmlPreview>
      </EmailHeadDefaults>
      <EmailBody>
        <EmailHeader />

        <MjmlSection padding={`24px ${emailTheme.gutter} 0`}>
          <MjmlColumn>
            <MjmlText fontSize="24px" fontWeight="bold" lineHeight="1.25" color={emailTheme.heading} padding="0 0 16px">
              New sign-in to your account
            </MjmlText>
            <MjmlText fontSize="16px" lineHeight="1.5" color={emailTheme.body} padding="0 0 4px">
              {greeting}
            </MjmlText>
            <MjmlText fontSize="16px" lineHeight="1.5" color={emailTheme.body} padding="0 0 16px">
              We detected a new sign-in to your Seed Hypermedia. This is your login link.
            </MjmlText>
            <EmailButton href={loginUrl} padding="0 0 16px">
              Log in to Hyper.media
            </EmailButton>
            <MjmlText fontSize="13px" color={emailTheme.muted} lineHeight="1.5" padding="0 0 24px">
              If you don't recognise this activity, please change your password immediately. This link will expire in 15
              minutes.
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        <EmailFooter />
      </EmailBody>
    </Mjml>,
  )

  return {subject, text, html}
}
