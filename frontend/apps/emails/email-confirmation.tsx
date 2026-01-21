import {
  Mjml,
  MjmlBody,
  MjmlButton,
  MjmlColumn,
  MjmlHead,
  MjmlImage,
  MjmlPreview,
  MjmlSection,
  MjmlText,
  MjmlTitle,
} from '@faire/mjml-react'
import {renderReactToMjml} from './notifier'

export type LoginConfirmationEmailProps = {
  loginUrl: string
}

export function createLoginConfirmationEmail({
  loginUrl,
}: LoginConfirmationEmailProps) {
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
            <MjmlText
              fontSize="18px"
              fontWeight="bold"
              color="#068f7b"
              padding="10px 0 0"
              align="center"
            >
              Seed Hypermedia
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>

        <MjmlSection
          backgroundColor="#ffffff"
          borderRadius="8px"
          padding="32px 24px"
        >
          <MjmlColumn>
            <MjmlText
              fontSize="24px"
              fontWeight="bold"
              color="#1a1a1a"
              padding="0 0 24px"
            >
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
              align="left"
            >
              Log in to Seed Hypermedia
            </MjmlButton>

            <MjmlText fontSize="14px" color="#71717a" lineHeight="1.5" padding="0">
              This link will expire in 15 minutes. If you didn't request this,
              you can safely ignore this email.
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

  return {subject, text, html}
}
