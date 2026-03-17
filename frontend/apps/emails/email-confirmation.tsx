import {
  Mjml,
  MjmlBody,
  MjmlButton,
  MjmlColumn,
  MjmlHead,
  MjmlPreview,
  MjmlSection,
  MjmlText,
  MjmlTitle,
} from '@faire/mjml-react'
import {EmailFooter} from './components/EmailFooter'
import {EmailHeader} from './components/EmailHeader'
import {renderReactToMjml} from './notifier'

export type LoginConfirmationEmailProps = {
  loginUrl: string
}

/** Build the one-time login link email. */
export function createLoginConfirmationEmail({loginUrl}: LoginConfirmationEmailProps) {
  const subject = 'Your login link for Seed Hypermedia'
  const text = `Your login link for Seed Hypermedia

Click the link below to log in:
${loginUrl}

This link will expire in 15 minutes. If you didn't request this, you can safely ignore this email.

Seed Hypermedia`

  const {html} = renderReactToMjml(
    <Mjml>
      <MjmlHead>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>Click to log in to Seed Hypermedia</MjmlPreview>
      </MjmlHead>
      <MjmlBody width={500} backgroundColor="#ffffff">
        <EmailHeader />

        <MjmlSection padding="24px">
          <MjmlColumn>
            <MjmlText fontSize="24px" fontWeight="bold" color="#1a1a1a" padding="0 0 24px">
              Your login link
            </MjmlText>

            <MjmlButton
              href={loginUrl}
              backgroundColor="#068f7b"
              color="#ffffff"
              fontSize="16px"
              fontWeight="600"
              borderRadius="6px"
              padding="0 0 24px"
              innerPadding="14px 28px"
              align="center"
            >
              Log in to Seed Hypermedia
            </MjmlButton>

            <MjmlText fontSize="14px" color="#71717a" lineHeight="1.5" padding="0">
              This link will expire in 15 minutes. If you didn't request this, you can safely ignore this email.
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        <EmailFooter />
      </MjmlBody>
    </Mjml>,
  )

  return {subject, text, html}
}
