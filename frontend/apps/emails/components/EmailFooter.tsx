import {MjmlColumn, MjmlSection, MjmlText} from '@faire/mjml-react'
import {emailTheme} from './EmailLayout'

/** Props for the unified email footer. */
export interface EmailFooterProps {
  /** Site URL shown in the "With 💚" line (e.g. "https://seedteamtalks.hyper.media"). When omitted the line is not rendered. */
  siteUrl?: string
  /** URL for the "Unsubscribe" link. When omitted the link is not rendered (e.g. transactional emails). */
  unsubscribeUrl?: string
  /** URL for the "Manage notifications" link. When omitted the link is not rendered. */
  manageNotificationsUrl?: string
}

const linkStyle: React.CSSProperties = {color: emailTheme.primaryText, textDecoration: 'underline'}

/** Unified footer rendered at the bottom of every outbound email. */
export function EmailFooter({siteUrl, unsubscribeUrl, manageNotificationsUrl}: EmailFooterProps) {
  const links: Array<{label: string; href: string}> = []
  if (unsubscribeUrl) links.push({label: 'Unsubscribe', href: unsubscribeUrl})
  links.push({label: 'Privacy policy', href: 'https://hyper.media/privacy'})
  if (manageNotificationsUrl) links.push({label: 'Manage notifications', href: manageNotificationsUrl})

  return (
    <>
      {siteUrl ? (
        <MjmlSection padding={`16px ${emailTheme.gutter} 32px`}>
          <MjmlColumn>
            <MjmlText fontSize="14px" color={emailTheme.primaryText} align="center" lineHeight="1.6" padding="0">
              With 💚
              <br />
              <a href={siteUrl} style={linkStyle}>
                {siteUrl}
              </a>
            </MjmlText>
          </MjmlColumn>
        </MjmlSection>
      ) : null}

      <MjmlSection
        backgroundColor={emailTheme.footerBackground}
        padding={`32px ${emailTheme.gutter}`}
        borderRadius={`0 0 ${emailTheme.cardRadius} ${emailTheme.cardRadius}`}
      >
        <MjmlColumn>
          <MjmlText fontSize="14px" color={emailTheme.body} lineHeight="1.6" padding="0 0 16px">
            You're receiving this email because someone signed up for an account using this address. This is a
            transactional email related to your account security.
          </MjmlText>
          <MjmlText fontSize="14px" lineHeight="1.6" padding="0">
            {links.map((link, i) => (
              <span key={link.label}>
                {i > 0 ? <span style={{display: 'inline-block', width: '36px'}} /> : null}
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
