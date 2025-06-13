import fs from 'fs'
import {sendNotificationsEmail} from './sender'

const {email, opts, notifications} = JSON.parse(
  fs.readFileSync('./mock-notification2.json', 'utf-8'),
)

;(async () => {
  sendNotificationsEmail(email, opts, notifications)

  console.log('✅ Test email sent successfully')
})()
