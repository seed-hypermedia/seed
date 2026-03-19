import {MjmlColumn, MjmlSection, MjmlText} from '@faire/mjml-react'

/** Props for the unified email footer. */
export interface EmailFooterProps {
  /** Site URL shown in the "With 💚" line (e.g. "https://seedteamtalks.hyper.media"). When omitted the line is not rendered. */
  siteUrl?: string
  /** URL for the "Unsubscribe" link. When omitted the link is not rendered (e.g. transactional emails). */
  unsubscribeUrl?: string
  /** URL for the "Manage notifications" link. When omitted the link is not rendered. */
  manageNotificationsUrl?: string
}

const linkStyle: React.CSSProperties = {color: '#068f7b', textDecoration: 'underline'}

/** Unified footer rendered at the bottom of every outbound email. */
export function EmailFooter({siteUrl, unsubscribeUrl, manageNotificationsUrl}: EmailFooterProps) {
  const links: Array<{label: string; href: string}> = []
  if (unsubscribeUrl) links.push({label: 'Unsubscribe', href: unsubscribeUrl})
  links.push({label: 'Privacy policy', href: 'https://hyper.media/privacy'})
  if (manageNotificationsUrl) links.push({label: 'Manage notifications', href: manageNotificationsUrl})

  return (
    <>
      {siteUrl ? (
        <MjmlSection padding="24px 24px 16px">
          <MjmlColumn>
            <MjmlText fontSize="13px" color="#6b7280" align="center" lineHeight="1.6" padding="0">
              With 💚
              <br />
              <a href={siteUrl} style={{color: '#068f7b', textDecoration: 'none'}}>
                {siteUrl}
              </a>
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>
      ) : null}

      <MjmlSection backgroundColor="#fdf8ee" padding="24px 24px 20px" borderRadius="0">
        <MjmlColumn>
          <MjmlText fontSize="12px" color="#6b7280" lineHeight="1.6" align="center" padding="0 0 12px">
            You're receiving this email because someone signed up for an account using this address. This is a
            transactional email related to your account security.
          </MjmlText>
          <MjmlText fontSize="12px" align="center" lineHeight="1.6" padding="0">
            {links.map((link, i) => (
              <span key={link.label}>
                {i > 0 ? '    ' : ''}
                <a href={link.href} style={linkStyle}>
                  {link.label}
                </a>
              </span>
            ))}
          </MjmlText>
        </MjmlColumn>
      </MjmlSection>
    </>
  )
}
