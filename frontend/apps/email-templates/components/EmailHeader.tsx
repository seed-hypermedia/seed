import {
  MjmlColumn,
  MjmlGroup,
  MjmlImage,
  MjmlSection,
  MjmlText,
} from "@faire/mjml-react";

export function getDaemonFileUrl(ipfsUrl?: string) {
  if (ipfsUrl) {
    return `http://localhost:58001/ipfs/${extractIpfsUrlCid(ipfsUrl)}`;
  }
  return "";
}

export function extractIpfsUrlCid(cidOrIPFSUrl: string): string {
  const regex = /^ipfs:\/\/(.+)$/;
  const match = cidOrIPFSUrl.match(regex);
  return match ? match[1] : cidOrIPFSUrl;
}

export function EmailHeader({avatarUrl}: {avatarUrl: string}) {
  return (
    <MjmlSection padding="16px 24px" border-bottom="1px solid #eee">
      {/* <MjmlColumn width="50%" verticalAlign="middle"> */}
      <MjmlGroup direction="ltr" verticalAlign="top" width="50%">
        <MjmlImage
          src="https://iili.io/FJ0pBl1.png"
          alt="Seed Logo"
          width="16px"
          height="20px"
          paddingRight="10px"
        />
        <MjmlText fontSize="16px" fontWeight="bold" color="#068f7b" padding="0">
          Seed Hypermedia
        </MjmlText>
      </MjmlGroup>
      {/* </MjmlColumn> */}
      <MjmlColumn width="50%" verticalAlign="middle">
        <MjmlImage
          src={getDaemonFileUrl(avatarUrl)}
          alt="User Avatar"
          align="right"
          borderRadius="50%"
          width="24px"
          height="24px"
        />
      </MjmlColumn>
    </MjmlSection>
  );
}
