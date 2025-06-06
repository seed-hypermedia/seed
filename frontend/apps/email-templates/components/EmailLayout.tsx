import {
  Mjml,
  MjmlBody,
  MjmlHead,
  MjmlPreview,
  MjmlTitle,
  MjmlWrapper,
} from "@faire/mjml-react";
import {EmailHeader} from "./EmailHeader";

export function EmailLayout({
  title,
  preview,
  avatarUrl,
  children,
}: {
  title: string;
  preview: string;
  avatarUrl: string;
  children: React.ReactNode;
}) {
  return (
    <Mjml>
      <MjmlHead>
        <MjmlTitle>{title}</MjmlTitle>
        <MjmlPreview>{preview}</MjmlPreview>
      </MjmlHead>
      <MjmlBody width={600}>
        <MjmlWrapper backgroundColor="#ffffff">
          <EmailHeader avatarUrl={avatarUrl} />
          {children}
        </MjmlWrapper>
      </MjmlBody>
    </Mjml>
  );
}
