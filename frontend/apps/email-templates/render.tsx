import fs from "fs";
import {sendNotificationsEmail} from "./notifier";

const {email, opts, notifications} = JSON.parse(
  fs.readFileSync("./mock-notification.json", "utf-8")
);

(async () => {
  // console.log(email, opts, notifications);
  // console.log("ENV vars:", {
  //   host: process.env.NOTIFY_SMTP_HOST,
  //   port: process.env.NOTIFY_SMTP_PORT,
  //   user: process.env.NOTIFY_SMTP_USER,
  //   pass: process.env.NOTIFY_SMTP_PASSWORD,
  //   sender: process.env.NOTIFY_SENDER,
  // });

  // const mjml = renderToMjml(
  //   <EmailLayout
  //     title="You have a new reply!"
  //     preview="Gabo replied to your comment"
  //     avatarUrl="https://example.com/avatar.png"
  //   >
  //     <MjmlSection>
  //       <MjmlText>Hello! This is a placeholder reply email.</MjmlText>
  //     </MjmlSection>
  //   </EmailLayout>
  // );

  // const {html} = mjml2html(mjml);
  // const text = "You were mentioned by Alice.";

  // fs.writeFileSync("output.html", html);

  // await sendEmail(
  //   "iskak@mintter.com",
  //   "Test Notification Email",
  //   {text, html},
  //   "Seed Notifications"
  // );
  sendNotificationsEmail(email, opts, notifications);

  console.log("✅ Test email sent successfully");
})();
