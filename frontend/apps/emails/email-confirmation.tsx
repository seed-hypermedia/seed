import {
  Mjml,
  MjmlBody,
  MjmlButton,
  MjmlColumn,
  MjmlPreview,
  MjmlSection,
  MjmlText,
  MjmlTitle,
} from '@faire/mjml-react'
import {EmailFooter} from './components/EmailFooter'
import {EmailHeader} from './components/EmailHeader'
import {EmailHeadDefaults, renderReactToMjml} from './notifier'

export type LoginConfirmationEmailProps = {
  loginUrl: string
  recipientName?: string
}

/** Build the login link email matching the "New sign-in" design. */
export function createLoginConfirmationEmail({loginUrl, recipientName}: LoginConfirmationEmailProps) {
  const subject = 'New sign-in to your account'
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hi there,'
  const text = `${subject}

${greeting}

We detected a new sign-in to your Seed Hypermedia. This is your login link.

${loginUrl}

If you don't recognise this activity, please change your password immediately.
This link will expire in 15 minutes.`

  const {html} = renderReactToMjml(
    <Mjml>
      <EmailHeadDefaults>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>A new sign-in was detected on your Seed Hypermedia account</MjmlPreview>
      </EmailHeadDefaults>
      <MjmlBody width={500} backgroundColor="#ffffff">
        <EmailHeader />

        <MjmlSection padding="24px 24px 0">
          <MjmlColumn>
            <MjmlText fontSize="24px" fontWeight="bold" lineHeight="1.3" padding="0 0 16px">
              New sign-in to your account
            </MjmlText>
            <MjmlText fontSize="15px" lineHeight="1.6" padding="0 0 4px">
              {greeting}
            </MjmlText>
            <MjmlText fontSize="15px" lineHeight="1.6" padding="0 0 16px">
              We detected a new sign-in to your Seed Hypermedia. This is your login link.
            </MjmlText>
            <MjmlButton
              href={loginUrl}
              backgroundColor="#068f7b"
              color="#ffffff"
              borderRadius="6px"
              fontSize="14px"
              fontWeight="600"
              innerPadding="12px 24px"
              align="center"
              padding="0 0 16px"
            >
              Log in to Hyper.media
            </MjmlButton>
            <MjmlText fontSize="13px" color="#6b7280" lineHeight="1.5" padding="0 0 24px">
              If you don't recognise this activity, please change your password immediately. This link will expire in 15
              minutes.
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        <EmailFooter />
      </MjmlBody>
    </Mjml>,
  )

  return {subject, text, html}
}
