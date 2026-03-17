import {MjmlColumn, MjmlImage, MjmlSection, MjmlText} from '@faire/mjml-react'

/** Centered logo + brand text header for all outbound emails. */
export function EmailHeader() {
  return (
    <MjmlSection padding="24px 24px 16px" borderBottom="1px solid #eeeeee">
      <MjmlColumn>
        <MjmlImage
          src="https://static.hyper.media/email/seed-logo.png"
          alt="Seed Logo"
          width="24px"
          height="30px"
          padding="0"
          align="center"
        />
        <MjmlText fontSize="16px" fontWeight="bold" color="#068f7b" padding="8px 0 0" align="center">
          Seed Hypermedia
        </MjmlText>
      </MjmlColumn>
    </MjmlSection>
  )
}
