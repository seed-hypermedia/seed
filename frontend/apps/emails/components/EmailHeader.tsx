import {MjmlColumn, MjmlImage, MjmlSection} from '@faire/mjml-react'
import {emailTheme} from './EmailLayout'

/** Logo header for all outbound emails. */
export function EmailHeader() {
  return (
    <MjmlSection padding={`40px ${emailTheme.gutter} 8px`}>
      <MjmlColumn>
        <MjmlImage
          src="https://seed.hyper.media/email-logo.png"
          alt="Seed Hypermedia"
          width="40px"
          height="40px"
          padding="0"
          align="left"
        />
      </MjmlColumn>
    </MjmlSection>
  )
}
