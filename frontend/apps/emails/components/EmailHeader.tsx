import {MjmlColumn, MjmlImage, MjmlSection} from '@faire/mjml-react'

/** Logo header for all outbound emails. */
export function EmailHeader() {
  return (
    <MjmlSection padding="24px 24px 16px">
      <MjmlColumn>
        <MjmlImage
          src="https://static.hyper.media/email/seed-logo.png"
          alt="Seed Logo"
          width="24px"
          height="30px"
          padding="0"
          align="left"
        />
      </MjmlColumn>
    </MjmlSection>
  )
}
