import {MjmlColumn, MjmlSection, MjmlText} from '@faire/mjml-react'

interface NotifSettingsProps {
  url: string
}

export function NotifSettings({url}: NotifSettingsProps) {
  return (
    <MjmlSection>
      <MjmlColumn>
        <MjmlText align="center" fontSize="14px" color="#666666">
          Subscribed by mistake?{' '}
          <a href={url} style={{color: '#0066cc', textDecoration: 'underline'}}>
            Click here to unsubscribe
          </a>
        </MjmlText>
      </MjmlColumn>
    </MjmlSection>
  )
}
