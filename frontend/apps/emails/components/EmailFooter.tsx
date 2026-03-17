import {MjmlColumn, MjmlDivider, MjmlSection, MjmlText} from '@faire/mjml-react'

/** Props for the standard email footer. Pass `unsubscribeUrl` for notification emails; omit for transactional (verification/login). */
export interface EmailFooterProps {
  /** URL for the "Manage notifications" link. When omitted the link is not rendered. */
  unsubscribeUrl?: string
}

/** Legal footer rendered at the bottom of every outbound email. */
export function EmailFooter({unsubscribeUrl}: EmailFooterProps) {
  return (
    <>
      <MjmlSection padding="0 24px">
        <MjmlColumn>
          <MjmlDivider borderColor="#eeeeee" borderWidth="1px" padding="24px 0 16px" />
        </MjmlColumn>
      </MjmlSection>

      {unsubscribeUrl ? (
        <MjmlSection padding="0 24px 8px">
          <MjmlColumn>
            <MjmlText fontSize="12px" color="#999999" align="center" lineHeight="1.6">
              <a href={unsubscribeUrl} style={{color: '#068f7b', textDecoration: 'underline'}}>
                Manage notifications
              </a>
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>
      ) : null}

      <MjmlSection padding="0 24px 8px">
        <MjmlColumn>
          <MjmlText fontSize="12px" color="#999999" align="center" lineHeight="1.6">
            <a href="https://x.com/seedhypermedia" style={{color: '#999999', textDecoration: 'none'}}>
              X / Twitter
            </a>
            {' · '}
            <a href="https://github.com/seed-hypermedia" style={{color: '#999999', textDecoration: 'none'}}>
              GitHub
            </a>
            {' · '}
            <a href="https://discord.gg/seedhypermedia" style={{color: '#999999', textDecoration: 'none'}}>
              Discord
            </a>
          </MjmlText>
        </MjmlColumn>
      </MjmlSection>

      <MjmlSection padding="0 24px 8px">
        <MjmlColumn>
          <MjmlText fontSize="12px" color="#999999" align="center" lineHeight="1.6">
            <a href="https://hyper.media/terms" style={{color: '#999999', textDecoration: 'none'}}>
              Terms of Service
            </a>
            {' · '}
            <a href="https://hyper.media/privacy" style={{color: '#999999', textDecoration: 'none'}}>
              Privacy Policy
            </a>
          </MjmlText>
        </MjmlColumn>
      </MjmlSection>

      <MjmlSection padding="0 24px 24px">
        <MjmlColumn>
          <MjmlText fontSize="12px" color="#999999" align="center" lineHeight="1.6">
            © {new Date().getFullYear()} Seed Hypermedia
            <br />
            [Address placeholder]
          </MjmlText>
        </MjmlColumn>
      </MjmlSection>
    </>
  )
}
