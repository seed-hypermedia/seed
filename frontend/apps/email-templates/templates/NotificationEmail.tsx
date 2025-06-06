import {
  Mjml,
  MjmlBody,
  MjmlButton,
  MjmlHead,
  MjmlPreview,
  MjmlSection,
  MjmlText,
  MjmlTitle,
} from "@faire/mjml-react";

export function NotificationEmail({
  documentTitle,
  summary,
  url,
}: {
  documentTitle: string;
  summary: string;
  url: string;
}) {
  return (
    <Mjml>
      <MjmlHead>
        <MjmlTitle>{documentTitle}</MjmlTitle>
        <MjmlPreview>{summary}</MjmlPreview>
      </MjmlHead>
      <MjmlBody width={500}>
        <MjmlSection>
          <MjmlText fontSize={20} fontWeight="bold">
            {documentTitle}
          </MjmlText>
          <MjmlText>{summary}</MjmlText>
          <MjmlButton href={url} backgroundColor="#346DB7">
            Open Document
          </MjmlButton>
        </MjmlSection>
      </MjmlBody>
    </Mjml>
  );
}
