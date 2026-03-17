/**
 * Render all email template previews to HTML files.
 *
 * Run: npx tsx --conditions=import render-all-previews.tsx
 *
 * Then open email-previews/index.html in your browser.
 */
import fs from 'fs'
import {createLoginConfirmationEmail} from './email-confirmation'
import {
  createCommentEmail,
  createDocUpdateEmail,
  createMentionEmail,
  createNotificationVerificationEmail,
  createReplyEmail,
} from './notifier'

const mockBlocks = [
  {
    block: {
      id: 'block1',
      type: 'Paragraph',
      text: 'Hey, I think we should revisit the color palette for the navigation bar. The current teal feels too muted on mobile screens.',
      annotations: [
        {type: 'Bold', starts: [4], ends: [7]},
        {type: 'Italic', starts: [51], ends: [65]},
      ],
    },
    children: [],
  },
  {
    block: {
      id: 'block2',
      type: 'Paragraph',
      text: 'What do you think?',
      annotations: [],
    },
    children: [],
  },
]

const previews: Array<{name: string; result: {subject: string; text: string; html: string}}> = [
  {
    name: 'mention',
    result: createMentionEmail({
      authorName: 'Eric Alex',
      subjectName: 'you',
      documentName: 'Design Guidelines',
      sectionName: 'Design',
      commentBlocks: mockBlocks,
      actionUrl: 'https://hyper.media/d/abc123',
      unsubscribeUrl: 'https://hyper.media/hm/email-notifications?token=test123',
    }),
  },
  {
    name: 'reply',
    result: createReplyEmail({
      authorName: 'Gabo',
      documentName: 'User test Round III',
      sectionName: 'Design',
      commentBlocks: mockBlocks,
      actionUrl: 'https://hyper.media/d/abc123',
      unsubscribeUrl: 'https://hyper.media/hm/email-notifications?token=test123',
    }),
  },
  {
    name: 'doc-update',
    result: createDocUpdateEmail({
      authorName: 'Gabo',
      documentName: 'Inspiration',
      sectionName: 'Design',
      changes: ['Updated the hero section layout', 'Added new color tokens', 'Removed deprecated spacing variables'],
      actionUrl: 'https://hyper.media/d/abc123',
      unsubscribeUrl: 'https://hyper.media/hm/email-notifications?token=test123',
    }),
  },
  {
    name: 'comment',
    result: createCommentEmail({
      authorName: 'Horacio',
      documentName: 'User Onboarding',
      sectionName: 'Design',
      commentBlocks: mockBlocks,
      actionUrl: 'https://hyper.media/d/abc123',
      unsubscribeUrl: 'https://hyper.media/hm/email-notifications?token=test123',
    }),
  },
  {
    name: 'verification',
    result: createNotificationVerificationEmail({
      verificationUrl: 'https://hyper.media/hm/notification-email-verify?token=verify123',
    }),
  },
  {
    name: 'login',
    result: createLoginConfirmationEmail({
      loginUrl: 'https://hyper.media/login?token=login123',
    }),
  },
]

const outputDir = './email-previews'
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir)

for (const {name, result} of previews) {
  fs.writeFileSync(`${outputDir}/${name}.html`, result.html)
  console.log(`Subject: ${result.subject}`)
  console.log(`  -> ${outputDir}/${name}.html`)
}

// Index page with links to all previews
const indexHtml = `<!DOCTYPE html>
<html><head><title>Email Previews</title>
<style>body{font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px}
a{display:block;padding:12px 0;font-size:18px;color:#068f7b;text-decoration:none;border-bottom:1px solid #eee}
a:hover{color:#045c50}</style></head>
<body><h1>Email Template Previews</h1>
${previews.map(({name}) => `<a href="${name}.html">${name}</a>`).join('\n')}
</body></html>`
fs.writeFileSync(`${outputDir}/index.html`, indexHtml)

console.log(`\nAll previews written to ${outputDir}/`)
console.log(`Open ${outputDir}/index.html in a browser to browse them.`)
