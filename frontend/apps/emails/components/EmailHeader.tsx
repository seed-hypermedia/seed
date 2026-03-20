import { MjmlColumn, MjmlImage, MjmlSection } from '@faire/mjml-react'

/** Logo header for all outbound emails. */
export function EmailHeader() {
  return (
    <MjmlSection padding="24px 24px 16px">
      <MjmlColumn>
        <MjmlImage
          src="https://seed.hyper.media/landing-assets/email-logo.png"
          alt="Seed Logo"
          width="48px"
          height="48px"
          padding="0"
          align="left"
        />
      </MjmlColumn>
    </MjmlSection>
  )
}
