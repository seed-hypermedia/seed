import {
  Mjml,
  MjmlBody,
  MjmlColumn,
  MjmlHead,
  MjmlImage,
  MjmlPreview,
  MjmlSection,
  MjmlText,
  MjmlTitle,
} from '@faire/mjml-react'
import {renderToMjml} from '@faire/mjml-react/utils/renderToMjml'
import mjml2html from 'mjml'

/** Rendered verification email with subject, plain text, and HTML. */
export type VerificationEmail = {
  subject: string
  text: string
  html: string
}

/** Render a verification email for the given code. */
export function createVerificationEmail(code: string): VerificationEmail {
  const subject = 'Your verification code for Seed Hypermedia'
  const text = `Your verification code for Seed Hypermedia

Enter this code in the browser where you requested it:
${code}

This code will expire in 15 minutes. If you didn't request this, you can safely ignore this email.

Seed Hypermedia`

  const mjmlMarkup = renderToMjml(
    <Mjml>
      <MjmlHead>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>Enter this code to continue in Seed Hypermedia</MjmlPreview>
      </MjmlHead>
      <MjmlBody width={500} backgroundColor="#f4f4f5">
        <MjmlSection padding="40px 0 20px">
          <MjmlColumn>
            <MjmlImage
              src="https://iili.io/FJ0pBl1.png"
              alt="Seed Logo"
              width="24px"
              height="30px"
              padding="0"
              align="center"
            />
            <MjmlText fontSize="18px" fontWeight="bold" color="#068f7b" padding="10px 0 0" align="center">
              Seed Hypermedia
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        <MjmlSection backgroundColor="#ffffff" borderRadius="8px" padding="32px 24px">
          <MjmlColumn>
            <MjmlText fontSize="24px" fontWeight="bold" color="#1a1a1a" padding="0 0 24px">
              Your verification code
            </MjmlText>

            <MjmlText
              fontSize="32px"
              fontWeight="700"
              color="#1a1a1a"
              letterSpacing="8px"
              padding="0 0 24px"
              align="center"
            >
              {code}
            </MjmlText>

            <MjmlText fontSize="14px" color="#71717a" lineHeight="1.5" padding="0">
              This code will expire in 15 minutes. Enter it in the browser where you requested it. If you didn't request
              this, you can safely ignore this email.
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        <MjmlSection padding="24px 0">
          <MjmlColumn>
            <MjmlText fontSize="12px" color="#a1a1aa" align="center">
              Seed Hypermedia
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>
      </MjmlBody>
    </Mjml>,
  )

  const {html} = mjml2html(mjmlMarkup)

  return {subject, text, html}
}
