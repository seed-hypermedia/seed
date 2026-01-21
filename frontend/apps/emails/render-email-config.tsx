import fs from 'fs'
import {createLoginConfirmationEmail} from './email-confirmation'

const {html, text, subject} = createLoginConfirmationEmail({
  loginUrl: 'https://example.com/login?token=abc123xyz',
})

// Write HTML to file for preview in browser
fs.writeFileSync('./login-preview.html', html)

console.log('Subject:', subject)
console.log('\nPlain text version:')
console.log(text)
console.log('\n✅ HTML preview written to login-preview.html')
