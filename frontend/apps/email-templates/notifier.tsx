import {PlainMessage} from "@bufbuild/protobuf";
import {
  Mjml,
  MjmlBody,
  MjmlButton,
  MjmlColumn,
  MjmlHead,
  MjmlPreview,
  MjmlSection,
  MjmlText,
  MjmlTitle,
} from "@faire/mjml-react";
import {renderToMjml} from "@faire/mjml-react/utils/renderToMjml";
import {
  Comment,
  HMMetadata,
  SITE_BASE_URL,
  UnpackedHypermediaId,
} from "@shm/shared";
import mjml2html from "mjml";
import {MJMLParseResults} from "mjml-core";
import React from "react";
import {sendEmail} from "../web/app/mailer";
import {EmailContent} from "./components/EmailContent";
import {EmailHeader} from "./components/EmailHeader";

export async function sendNotificationsEmail(
  email: string,
  opts: {adminToken: string; isUnsubscribed: boolean; createdAt: string},
  notifications: FullNotification[]
) {
  if (!notifications.length) return;
  const subscriberNames: Set<string> = new Set();
  const notificationsByDocument: Record<string, FullNotification[]> = {};
  for (const notification of notifications) {
    if (!notificationsByDocument[notification.notif.targetId.id]) {
      notificationsByDocument[notification.notif.targetId.id] = [];
    }
    notificationsByDocument[notification.notif.targetId.id].push(notification);
    subscriberNames.add(notification.accountMeta?.name || "You");
  }
  const docNotifs = Object.values(notificationsByDocument);
  const baseNotifsSubject =
    notifications.length > 1
      ? `${notifications.length} Notifications`
      : "Notification";
  let subject = baseNotifsSubject;
  const singleDocumentTitle = notifications.every(
    (n) => n.notif.targetMeta?.name === notifications[0].notif.targetMeta?.name
  )
    ? notifications[0].notif.targetMeta?.name
    : undefined;
  if (singleDocumentTitle) {
    subject = `${baseNotifsSubject} on ${singleDocumentTitle}`;
  }
  const firstNotificationSummary = getNotificationSummary(
    notifications[0].notif,
    notifications[0].accountMeta
  );
  const notifSettingsUrl = `${SITE_BASE_URL}/hm/email-notifications?token=${opts.adminToken}`;

  const text = `${baseNotifsSubject}

${docNotifs
  .map((notifications) => {
    const docName =
      notifications[0].notif.targetMeta?.name || "Untitled Document";
    return `${docName}

${notifications
  .map((notification) => {
    const comment = notification.notif.comment;
    return `New ${notification.notif.type} from ${comment.author} on ${notification.notif.url}`;
  })
  .join("\n")}
  
${notifications[0].notif.url}

`;
  })
  .join("\n")}

Subscribed by mistake? Click here to unsubscribe: ${notifSettingsUrl}`;

  const {html} = renderReactToMjml(
    <Mjml>
      <MjmlHead>
        <MjmlTitle>{subject}</MjmlTitle>
        {/* This preview is visible from the email client before the user clicks on the email */}
        <MjmlPreview>
          {notifications.length > 1
            ? `${firstNotificationSummary} and more`
            : firstNotificationSummary}
        </MjmlPreview>
      </MjmlHead>
      <MjmlBody width={500}>
        {/* <MjmlSection fullWidth backgroundColor="#efefef">
            <MjmlColumn>
              <MjmlImage src="https://static.wixstatic.com/media/5cb24728abef45dabebe7edc1d97ddd2.jpg" />
            </MjmlColumn>
          </MjmlSection> */}
        {docNotifs.map((notifications) => {
          return (
            <>
              <EmailHeader avatarUrl={notifications[0].accountMeta.icon} />
              <MjmlSection>
                <MjmlText fontSize={20} fontWeight={"bold"}>
                  {notifications[0].notif.targetMeta?.name ||
                    "Untitled Document"}
                </MjmlText>
                {notifications.map((notification) => {
                  return (
                    // <MjmlText paddingBottom={8} paddingTop={8}>
                    //   {getNotificationSummary(
                    //     notification.notif,
                    //     notification.accountMeta
                    //   )}
                    // </MjmlText>
                    <>
                      <EmailContent notification={notification.notif} />
                      <MjmlSection padding="0px">
                        <MjmlColumn>
                          <MjmlText lineHeight="1" fontSize="1px">
                            &nbsp;
                          </MjmlText>
                        </MjmlColumn>
                      </MjmlSection>
                    </>
                  );
                })}
                <MjmlButton
                  padding="8px"
                  backgroundColor="#346DB7"
                  href={notifications[0].notif.url}
                >
                  Open Document
                </MjmlButton>
              </MjmlSection>
            </>
          );
        })}
        <NotifSettings url={notifSettingsUrl} />
      </MjmlBody>
    </Mjml>
  );

  await sendEmail(
    email,
    subject,
    {text, html},
    `Hypermedia Updates for ${Array.from(subscriberNames).join(", ")}`
  );
}

function NotifSettings({url}: {url: string}) {
  return (
    <MjmlSection>
      <MjmlText fontSize={10} paddingBottom={10} align="center">
        Subscribed by mistake? Click here to unsubscribe:
      </MjmlText>
      <MjmlButton
        padding="8px"
        backgroundColor="#828282"
        href={url}
        align="center"
      >
        Manage Email Notifications
      </MjmlButton>
    </MjmlSection>
  );
}

export type Notification =
  | {
      type: "mention";
      comment: PlainMessage<Comment>;
      commentAuthorMeta: HMMetadata | null;
      targetMeta: HMMetadata | null;
      targetId: UnpackedHypermediaId;
      parentComments: PlainMessage<Comment>[];
      url: string;
    }
  | {
      type: "reply";
      comment: PlainMessage<Comment>;
      commentAuthorMeta: HMMetadata | null;
      targetMeta: HMMetadata | null;
      targetId: UnpackedHypermediaId;
      parentComments: PlainMessage<Comment>[];
      url: string;
    };

export type FullNotification = {
  accountId: string;
  accountMeta: HMMetadata | null;
  notif: Notification;
};

function getNotificationSummary(
  notification: Notification,
  accountMeta: HMMetadata | null
): string {
  if (notification.type === "mention") {
    return `${accountMeta?.name || "You were"} mentioned by ${
      notification.commentAuthorMeta?.name || notification.comment.author
    }.`;
  }
  if (notification.type === "reply") {
    return `You have a new reply from ${
      notification.commentAuthorMeta?.name || notification.comment.author
    }.`;
  }
  return "";
}

export function renderReactToMjml(email: React.ReactElement): MJMLParseResults {
  return mjml2html(renderToMjml(email));
}
