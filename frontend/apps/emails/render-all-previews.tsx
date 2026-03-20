/**
 * Render all email template previews to HTML files.
 *
 * Run: npx tsx --conditions=import render-all-previews.tsx
 *
 * Then open email-previews/index.html in your browser.
 */
import {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import fs from 'fs'
import {createLoginConfirmationEmail} from './email-confirmation'
import {
  createCommentEmail,
  createDiscussionEmail,
  createDocUpdateEmail,
  createMentionEmail,
  createNotificationVerificationEmail,
  createReplyEmail,
  createWelcomeEmail,
} from './notifier'

const mockBlocks: HMBlockNode[] = [
  {
    block: {
      id: 'block1',
      type: 'Paragraph',
      attributes: {},
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
      attributes: {},
      text: 'What do you think?',
      annotations: [],
    },
    children: [],
  },
]

const mentionBlocks: HMBlockNode[] = [
  {
    block: {
      id: 'block1',
      type: 'Paragraph',
      attributes: {},
      text: '@Bea — I think this approach solves the accessibility issue.',
      annotations: [
        {type: 'Embed', starts: [0], ends: [4], link: 'hm://bea-account-id'},
      ],
    },
    children: [],
  },
]

const previews: Array<{name: string; result: {subject: string; text: string; html: string}}> = [
  {
    name: 'verification',
    result: createNotificationVerificationEmail({
      verificationUrl: 'https://hyper.media/hm/notification-email-verify?token=verify123',
      recipientName: 'First Name',
    }),
  },
  {
    name: 'login',
    result: createLoginConfirmationEmail({
      loginUrl: 'https://hyper.media/login?token=login123',
      recipientName: 'First Name',
    }),
  },
  {
    name: 'welcome',
    result: createWelcomeEmail({
      recipientName: 'First Name',
      siteName: '<sitename>',
      siteUrl: 'https://seedteamtalks.hyper.media',
    }),
  },
  {
    name: 'discussion',
    result: createDiscussionEmail({
      authorName: 'Gabo',
      documentName: 'Inspiration',
      commentBlocks: mockBlocks,
      actionUrl: 'https://seedteamtalks.hyper.media/d/abc123',
      unsubscribeUrl: 'https://hyper.media/hm/email-notifications?token=test123',
      siteUrl: 'https://seedteamtalks.hyper.media',
    }),
  },
  {
    name: 'comment',
    result: createCommentEmail({
      authorName: 'Horacio',
      documentName: 'User Onboarding',
      sectionName: 'Design',
      commentBlocks: mockBlocks,
      actionUrl: 'https://seedteamtalks.hyper.media/d/abc123',
      unsubscribeUrl: 'https://hyper.media/hm/email-notifications?token=test123',
      siteUrl: 'https://seedteamtalks.hyper.media',
    }),
  },
  {
    name: 'mention',
    result: createMentionEmail({
      authorName: 'Eric Alex',
      subjectName: 'you',
      documentName: 'Design Guidelines',
      commentBlocks: mentionBlocks,
      actionUrl: 'https://seedteamtalks.hyper.media/d/abc123',
      unsubscribeUrl: 'https://hyper.media/hm/email-notifications?token=test123',
      siteUrl: 'https://seedteamtalks.hyper.media',
      resolvedNames: {'hm://bea-account-id': 'Bea'},
    }),
  },
  {
    name: 'reply',
    result: createReplyEmail({
      authorName: 'Gabo',
      documentName: 'User test Round III',
      sectionName: 'Design',
      commentBlocks: mockBlocks,
      actionUrl: 'https://seedteamtalks.hyper.media/d/abc123',
      unsubscribeUrl: 'https://hyper.media/hm/email-notifications?token=test123',
      siteUrl: 'https://seedteamtalks.hyper.media',
    }),
  },
  {
    name: 'doc-update',
    result: createDocUpdateEmail({
      authorName: 'Gabo',
      documentName: 'Inspiration',
      sectionName: 'Design',
      changes: ['Updated the hero section layout', 'Added new color tokens', 'Removed deprecated spacing variables'],
      actionUrl: 'https://seedteamtalks.hyper.media/d/abc123',
      unsubscribeUrl: 'https://hyper.media/hm/email-notifications?token=test123',
      siteUrl: 'https://seedteamtalks.hyper.media',
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
