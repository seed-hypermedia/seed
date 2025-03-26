import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {ENABLE_EMAIL_NOTIFICATIONS, Event} from '@shm/shared'
import SuperJSON from 'superjson'
import {queryClient} from './client'
import {
  getAllEmails,
  getNotifierLastProcessedBlobCid,
  setNotifierLastProcessedBlobCid,
} from './db'

export async function initEmailNotifier() {
  console.log('initEmailNotifier', {ENABLE_EMAIL_NOTIFICATIONS})
  if (!ENABLE_EMAIL_NOTIFICATIONS) return

  await handleEmailNotifications()
  console.log('Email notifications handled')

  setInterval(
    () => {
      handleEmailNotifications()
        .then(() => {
          console.log('Email notifications handled')
        })
        .catch((err) => {
          console.error('Error handling email notifications', err)
        })
    },
    1000 * 60 * 1,
  ) // 1 minute
}

async function handleEmailNotifications() {
  const lastProcessedBlobCid = getNotifierLastProcessedBlobCid()
  if (lastProcessedBlobCid) {
    await handleEmailNotificationsAfterBlobCid(lastProcessedBlobCid)
  } else {
    await resetNotifierLastProcessedBlobCid()
  }
}

async function resetNotifierLastProcessedBlobCid() {
  const {events} = await queryClient.activityFeed.listEvents({
    pageToken: undefined,
    pageSize: 5,
  })
  const event = events.at(0)
  if (!event) return
  const lastBlobCid =
    event.data.case === 'newBlob' && event.data.value?.cid
      ? event.data.value.cid
      : undefined
  if (!lastBlobCid) return
  setNotifierLastProcessedBlobCid(lastBlobCid)
}

async function handleEmailNotificationsAfterBlobCid(
  lastProcessedBlobCid: string,
) {
  const eventsToProcess = await loadEventsAfterBlobCid(lastProcessedBlobCid)
  if (eventsToProcess.length === 0) return
  await handleEventsForEmailNotifications(eventsToProcess)
  await markEventsAsProcessed(eventsToProcess)
}

async function handleEventsForEmailNotifications(
  events: PlainMessage<Event>[],
) {
  const allEmails = getAllEmails()
  console.log(
    'allEmails',
    JSON.stringify(SuperJSON.serialize(allEmails), null, 2),
  )
  console.log(
    'eventsToProcess',
    JSON.stringify(SuperJSON.serialize(events), null, 2),
  )
}

// to load change cid:
//   queryClient.entities.getChange({
//     id:
//   })

async function markEventsAsProcessed(events: PlainMessage<Event>[]) {
  const newestEvent = events.at(0)
  if (!newestEvent) return
  const lastProcessedBlobCid = newestEvent.data.value?.cid
  if (!lastProcessedBlobCid) return
  await setNotifierLastProcessedBlobCid(lastProcessedBlobCid)
}

async function loadEventsAfterBlobCid(lastProcessedBlobCid: string) {
  const eventsAfterBlobCid = []
  let currentPageToken: string | undefined

  while (true) {
    const {events, nextPageToken} = await queryClient.activityFeed.listEvents({
      pageToken: currentPageToken,
      pageSize: 2,
    })

    for (const event of events) {
      if (event.data.case === 'newBlob' && event.data.value?.cid) {
        if (event.data.value.cid === lastProcessedBlobCid) {
          return eventsAfterBlobCid
        }
        eventsAfterBlobCid.push(toPlainMessage(event))
      }
    }

    if (!nextPageToken) break
    currentPageToken = nextPageToken
  }

  return eventsAfterBlobCid
}
