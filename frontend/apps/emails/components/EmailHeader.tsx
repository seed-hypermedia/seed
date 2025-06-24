import {
  MjmlColumn,
  MjmlGroup,
  MjmlImage,
  MjmlRaw,
  MjmlSection,
  MjmlText,
} from '@faire/mjml-react'
import {DAEMON_FILE_URL} from '@shm/shared'

export function getDaemonFileUrl(ipfsUrl?: string) {
  if (ipfsUrl) {
    return `${DAEMON_FILE_URL}/${extractIpfsUrlCid(ipfsUrl)}`
  }
  return ''
}

export function extractIpfsUrlCid(cidOrIPFSUrl: string): string {
  const regex = /^ipfs:\/\/(.+)$/
  const match = cidOrIPFSUrl.match(regex)
  return match ? match[1] : cidOrIPFSUrl
}

export function EmailHeader({
  avatarUrl,
  name,
}: {
  avatarUrl: string
  name: string
}) {
  const fallbackLetter = name[0].toUpperCase()

  return (
    <MjmlSection padding="16px 24px" border-bottom="1px solid #eee">
      {/* <MjmlColumn width="50%" verticalAlign="middle"> */}
      <MjmlGroup width="70%">
        <MjmlColumn width="24px" paddingRight="10px" verticalAlign="middle">
          <MjmlImage
            src="https://iili.io/FJ0pBl1.png"
            alt="Seed Logo"
            width="16px"
            height="20px"
            padding="0"
          />
        </MjmlColumn>
        <MjmlColumn padding="0" verticalAlign="middle">
          <MjmlText
            fontSize="16px"
            fontWeight="bold"
            color="#068f7b"
            padding="0"
          >
            Seed Hypermedia
          </MjmlText>
        </MjmlColumn>
      </MjmlGroup>
      {/* </MjmlColumn> */}
      <MjmlColumn width="30%" verticalAlign="middle">
        {avatarUrl ? (
          <MjmlImage
            src={getDaemonFileUrl(avatarUrl)}
            alt="User Avatar"
            align="right"
            borderRadius="50%"
            width="28px"
            height="28px"
          />
        ) : (
          <MjmlRaw>
            <table
              role="presentation"
              border={0}
              cellPadding="0"
              cellSpacing="0"
              style={{float: 'right'}}
            >
              <tr>
                <td
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: '#ccc',
                    textAlign: 'center',
                    lineHeight: '24px',
                    fontWeight: 'bold',
                    fontSize: '12px',
                    color: '#ffffff',
                    fontFamily: 'sans-serif',
                  }}
                >
                  {fallbackLetter}
                </td>
              </tr>
            </table>
          </MjmlRaw>
        )}
      </MjmlColumn>
    </MjmlSection>
  )
}
