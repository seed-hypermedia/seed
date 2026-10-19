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
export function createVerificationEmail(code: string, logoUrl?: string): VerificationEmail {
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
            {logoUrl ? (
              <MjmlImage src={logoUrl} alt="Seed Logo" width="40px" height="40px" padding="0" align="center" />
            ) : null}
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

/** Render the invitation email: who invited, what role, and the one-time link. */
export function createInvitationEmail(
  link: string,
  opts: {siteName: string; role: 'reader' | 'writer'},
  logoUrl?: string,
): VerificationEmail {
  const siteName = opts.siteName || 'Seed Hypermedia'
  const subject = `You're invited to ${siteName}`
  const roleLine =
    opts.role === 'writer'
      ? 'You will be able to read and edit its documents.'
      : 'You will be able to read its documents.'
  const text = `${subject}

You have been invited to join ${siteName} on Seed Hypermedia. ${roleLine}

Open this link to create your account:
${link}

The link is for this email address and works once. If you weren't expecting it, you can ignore this email.

Seed Hypermedia`

  const mjmlMarkup = renderToMjml(
    <Mjml>
      <MjmlHead>
        <MjmlTitle>{subject}</MjmlTitle>
        <MjmlPreview>Create your account on {siteName}</MjmlPreview>
      </MjmlHead>
      <MjmlBody width={500} backgroundColor="#f4f4f5">
        <MjmlSection padding="40px 0 20px">
          <MjmlColumn>
            {logoUrl ? (
              <MjmlImage src={logoUrl} alt="Seed Logo" width="40px" height="40px" padding="0" align="center" />
            ) : null}
            <MjmlText fontSize="18px" fontWeight="bold" color="#068f7b" padding="10px 0 0" align="center">
              Seed Hypermedia
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        <MjmlSection backgroundColor="#ffffff" borderRadius="8px" padding="32px 24px">
          <MjmlColumn>
            <MjmlText fontSize="24px" fontWeight="bold" color="#1a1a1a" padding="0 0 16px">
              You're invited to {siteName}
            </MjmlText>
            <MjmlText fontSize="14px" color="#1a1a1a" lineHeight="1.5" padding="0 0 24px">
              You have been invited to join {siteName} on Seed Hypermedia. {roleLine}
            </MjmlText>
            <MjmlText fontSize="14px" padding="0 0 24px" align="center">
              <a
                href={link}
                style={{
                  display: 'inline-block',
                  backgroundColor: '#068f7b',
                  color: '#ffffff',
                  padding: '12px 20px',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
              >
                Create your account
              </a>
            </MjmlText>
            <MjmlText fontSize="12px" color="#71717a" lineHeight="1.5" padding="0 0 16px">
              Or open this link: <a href={link}>{link}</a>
            </MjmlText>
            <MjmlText fontSize="14px" color="#71717a" lineHeight="1.5" padding="0">
              The link is for this email address and works once. If you weren't expecting it, you can ignore this email.
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
