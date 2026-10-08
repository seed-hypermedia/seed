import {MjmlBody, MjmlButton, MjmlColumn, MjmlSection, MjmlWrapper} from '@faire/mjml-react'
import React from 'react'

/** Shared visual tokens for every outbound email. */
export const emailTheme = {
  pageBackground: '#f4f4f4',
  cardBackground: '#ffffff',
  cardRadius: '12px',
  footerBackground: '#fdfae9',
  primary: '#237a65',
  primaryText: '#1d5c45',
  heading: '#1a1a1a',
  body: '#52525b',
  muted: '#71717a',
  quoteBackground: '#f3f3f3',
  /** Horizontal padding of the card content. */
  gutter: '40px',
}

/** Page frame shared by all emails: gray page with a rounded white card in the middle. */
export function EmailBody({children}: {children: React.ReactNode}) {
  return (
    <MjmlBody width={600} backgroundColor={emailTheme.pageBackground}>
      <MjmlSection padding="16px 0" />
      <MjmlWrapper backgroundColor={emailTheme.cardBackground} borderRadius={emailTheme.cardRadius} padding="0">
        {children}
      </MjmlWrapper>
      <MjmlSection padding="16px 0" />
    </MjmlBody>
  )
}

/** Primary call-to-action button. */
export function EmailButton({href, children, padding}: {href: string; children: React.ReactNode; padding?: string}) {
  return (
    <MjmlButton
      href={href}
      backgroundColor={emailTheme.primary}
      color="#ffffff"
      borderRadius="8px"
      fontSize="16px"
      fontWeight="400"
      innerPadding="14px 18px"
      align="center"
      padding={padding}
    >
      {children}
    </MjmlButton>
  )
}

/** Section holding a single centered CTA button. */
export function EmailButtonSection({href, children}: {href: string; children: React.ReactNode}) {
  return (
    <MjmlSection padding={`8px ${emailTheme.gutter} 24px`}>
      <MjmlColumn>
        <EmailButton href={href}>{children}</EmailButton>
      </MjmlColumn>
    </MjmlSection>
  )
}
