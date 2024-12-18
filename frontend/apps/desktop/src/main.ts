import * as Sentry from '@sentry/electron/main'
import {
  BIG_INT,
  DAEMON_HTTP_URL,
  IS_PROD_DESKTOP,
  METRIC_SERVER_HTTP_PORT,
  defaultRoute,
} from '@shm/shared'
import {
  BrowserWindow,
  Menu,
  OpenDialogOptions,
  app,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  net,
  shell,
} from 'electron'

import contextMenu from 'electron-context-menu'
import squirrelStartup from 'electron-squirrel-startup'
import path from 'node:path'
import {
  handleSecondInstance,
  handleUrlOpen,
  openInitialWindows,
  trpc,
} from './app-api'
import {createAppMenu} from './app-menu'
import {startMetricsServer} from './app-metrics'
import {initPaths} from './app-paths'
import * as logger from './logger'

import fs from 'fs'
import mime from 'mime'
import {grpcClient} from './app-grpc'
import {APP_AUTO_UPDATE_PREFERENCE} from './app-settings'
import {appStore} from './app-store'
import autoUpdate from './auto-update'
import {startMainDaemon} from './daemon'
import {saveCidAsFile} from './save-cid-as-file'
import {saveMarkdownFile} from './save-markdown-file'

// @ts-ignore
global.electronTRPC = {}

const OS_REGISTER_SCHEME = 'hm'

initPaths()

contextMenu({
  showInspectElement: !IS_PROD_DESKTOP,
})

logger.info('[MAIN]: Seed Desktop Main Code')

const metricsServer = startMetricsServer(METRIC_SERVER_HTTP_PORT)
app.on('quit', async () => {
  await metricsServer.close()
})

if (IS_PROD_DESKTOP) {
  if (squirrelStartup) {
    app.quit()
  }

  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(OS_REGISTER_SCHEME, process.execPath, [
        path.resolve(process.argv[1]!),
      ])
    }
  } else {
    app.setAsDefaultProtocolClient(OS_REGISTER_SCHEME)
  }

  Sentry.init({
    debug: false,
    release: import.meta.env.VITE_VERSION,
    environment: import.meta.env.MODE,
    dsn: import.meta.env.VITE_DESKTOP_SENTRY_DSN,
    transportOptions: {
      // The maximum number of days to keep an event in the queue.
      maxQueueAgeDays: 30,
      // The maximum number of events to keep in the queue.
      maxQueueCount: 30,
      // Called every time the number of requests in the queue changes.
      queuedLengthChanged: (length) => {
        logger.debug('[MAIN]: Sentry queue changed', length)
      },
      // Called before attempting to send an event to Sentry. Used to override queuing behavior.
      //
      // Return 'send' to attempt to send the event.
      // Return 'queue' to queue and persist the event for sending later.
      // Return 'drop' to drop the event.
      // beforeSend: (request) => (isOnline() ? 'send' : 'queue'),
    },
  })
}

ipcMain.on('open-markdown-directory', async (event, accountId: string) => {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  if (!focusedWindow) {
    console.error('No focused window found.')
    return
  }

  const options = {
    title: 'Select directories containing Markdown files',
    properties: ['openDirectory', 'multiSelections'],
  }

  try {
    const result = await dialog.showOpenDialog(focusedWindow, options)
    if (!result.canceled && result.filePaths.length > 0) {
      const directories = result.filePaths
      const validDocuments = []

      const docMap = new Map<
        string,
        {relativePath?: string; name: string; path: string}
      >()

      for (const dirPath of directories) {
        const files = fs.readdirSync(dirPath)
        const isDirectory = fs.lstatSync(dirPath).isDirectory()

        // Import all markdown files in the root of the selected directory
        const markdownFiles = files.filter((file) => file.endsWith('.md'))
        if (markdownFiles.length > 0 && isDirectory) {
          for (const markdownFile of markdownFiles) {
            const markdownFilePath = path.join(dirPath, markdownFile)
            const markdownContent = fs.readFileSync(markdownFilePath, 'utf-8')

            const fileName = path.basename(markdownFile, '.md')
            const title = formatTitle(fileName)

            docMap.set('./' + markdownFile, {
              name: title,
              path: path.join(
                accountId,
                title.toLowerCase().replace(/\s+/g, '-'),
              ),
            })

            validDocuments.push({
              markdownContent,
              title,
              directoryPath: dirPath,
            })
          }
        }

        // // Check subdirectories for markdown files
        // const subdirectories = files.filter((file) =>
        //   fs.lstatSync(path.join(dirPath, file)).isDirectory(),
        // )

        // for (const subDir of subdirectories) {
        //   const subDirPath = path.join(dirPath, subDir)
        //   const subDirFiles = fs.readdirSync(subDirPath)

        //   // Get all markdown files in the subdirectory
        //   const subDirMarkdownFiles = subDirFiles.filter((file) =>
        //     file.endsWith('.md'),
        //   )

        //   // Loop through each markdown file in the subdirectory
        //   for (const subDirMarkdownFile of subDirMarkdownFiles) {
        //     const markdownFilePath = path.join(subDirPath, subDirMarkdownFile)
        //     const markdownContent = fs.readFileSync(markdownFilePath, 'utf-8')

        //     const fileName = path.basename(subDirMarkdownFile, '.md')
        //     const title = formatTitle(fileName)

        //     validDocuments.push({
        //       markdownContent,
        //       title,
        //       directoryPath: subDirPath,
        //     })
        //   }
        // }
      }

      event.sender.send('directories-content-response', {
        success: true,
        result: {
          documents: validDocuments,
          docMap: docMap,
        },
      })
    } else {
      event.sender.send('directories-content-response', {
        success: false,
        error: 'Directory selection was canceled',
      })
    }
  } catch (err) {
    console.error('Error selecting directories:', err)
    event.sender.send('directories-content-response', {
      success: false,
      error: err.message,
    })
  }
})

const formatTitle = (fileName: string) => {
  return fileName
    .replace(/\.md$/, '') // Remove .md extension
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between camel case words
    .replace(/[-_]/g, ' ') // Replace dashes and underscores with spaces
    .replace(/\b\w/g, (char) => char.toUpperCase()) // Capitalize each word
}

ipcMain.on('open-markdown-file', async (event, accountId: string) => {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  if (!focusedWindow) {
    console.error('No focused window found.')
    return
  }

  const options: OpenDialogOptions = {
    title: 'Select Markdown files',
    properties: ['openFile', 'multiSelections'],
    filters: [{name: 'Markdown Files', extensions: ['md']}],
  }

  try {
    const result = await dialog.showOpenDialog(focusedWindow, options)
    if (!result.canceled && result.filePaths.length > 0) {
      const files = result.filePaths
      const validDocuments = []
      const docMap = new Map<
        string,
        {relativePath?: string; name: string; path: string}
      >()

      for (const filePath of files) {
        const stats = fs.lstatSync(filePath)
        if (stats.isFile() && filePath.endsWith('.md')) {
          const markdownContent = fs.readFileSync(filePath, 'utf-8')
          // Extract and format title from directory name
          const dirName = path.basename(filePath)
          const title = formatTitle(dirName)

          docMap.set('./' + dirName, {
            name: title,
            path: path.join(
              accountId,
              title.toLowerCase().replace(/\s+/g, '-'),
            ),
          })

          validDocuments.push({
            markdownContent,
            title,
            directoryPath: path.dirname(filePath),
          })
        }
      }

      event.sender.send('files-content-response', {
        success: true,
        result: {documents: validDocuments, docMap: docMap},
      })
    } else {
      event.sender.send('files-content-response', {
        success: false,
        error: 'File selection was canceled',
      })
    }
  } catch (err) {
    console.error('Error selecting file:', err)
    event.sender.send('files-content-response', {
      success: false,
      error: err.message,
    })
  }
})

ipcMain.on('read-media-file', async (event, filePath) => {
  try {
    const absoluteFilePath = path.resolve(filePath)

    const fileContent = fs.readFileSync(absoluteFilePath)
    const mimeType = mime.getType(filePath)
    const fileName = path.basename(filePath)
    event.sender.send('media-file-content', {
      success: true,
      filePath,
      content: Buffer.from(fileContent).toString('base64'),
      mimeType,
      fileName,
    })
  } catch (error) {
    console.error('Error reading media file:', error)
    event.sender.send('media-file-content', {
      success: false,
      error: error.message,
    })
  }
})

startMainDaemon(() => {
  logger.info('DaemonStarted')
  initAccountSubscriptions()
    .then(() => {
      logger.info('InitAccountSubscriptionsComplete')
    })
    .catch((e) => {
      logger.error('InitAccountSubscriptionsError ' + e.message)
    })
})

async function initAccountSubscriptions() {
  logger.info('InitAccountSubscriptions')
  const keys = await grpcClient.daemon.listKeys({})
  const subs = await grpcClient.subscriptions.listSubscriptions({
    pageSize: BIG_INT,
  })
  const recursiveSubs = new Set(
    subs.subscriptions
      .map((sub) => {
        if (sub.path !== '/' || !sub.recursive) return null
        return sub.account
      })
      .filter((s) => !!s),
  )
  const keysToSubscribeTo = keys.keys.filter((key) => {
    if (recursiveSubs.has(key.accountId)) return false
    return true
  })

  for (const key of keysToSubscribeTo) {
    logger.debug('WillInitAccountSubscriptions')

    await grpcClient.subscriptions.subscribe({
      account: key.accountId,
      recursive: true,
      path: '/',
    })
  }
}

Menu.setApplicationMenu(createAppMenu())
let shouldAutoUpdate = appStore.get(APP_AUTO_UPDATE_PREFERENCE) || 'true'

if (shouldAutoUpdate == 'true') {
  autoUpdate()
} else {
  console.log('Auto-Update is set to OFF')
}

app.on('did-become-active', () => {
  logger.debug('[MAIN]: Seed active (did-become-active)')
  if (BrowserWindow.getAllWindows().length === 0) {
    logger.debug('[MAIN]: will open the home window')
    trpc.createAppWindow({
      routes: [defaultRoute],
    })
  }
})
app.on('did-resign-active', () => {
  // logger.debug('[MAIN]: Seed no longer active')
})

// dark mode support: https://www.electronjs.org/docs/latest/tutorial/dark-mode
ipcMain.handle('dark-mode:toggle', () => {
  if (nativeTheme.shouldUseDarkColors) {
    nativeTheme.themeSource = 'light'
  } else {
    nativeTheme.themeSource = 'dark'
  }
  return nativeTheme.shouldUseDarkColors
})

ipcMain.handle('dark-mode:system', () => {
  nativeTheme.themeSource = 'system'
})

ipcMain.on('save-file', saveCidAsFile)
ipcMain.on('export-document', saveMarkdownFile)

ipcMain.on(
  'export-multiple-documents',
  async (
    event,
    documents: {
      title: string
      markdown: {
        markdownContent: string
        mediaFiles: {url: string; filename: string; placeholder: string}[]
      }
    }[],
  ) => {
    const {debug, error} = console

    // Open a dialog to select a directory
    const {filePaths} = await dialog.showOpenDialog({
      title: 'Select Export Directory',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory'],
    })

    if (filePaths && filePaths.length > 0) {
      const exportDir = path.join(filePaths[0], 'Seed Documents')
      const mediaDir = path.join(exportDir, 'media')

      // Create the Seed Documents folder and the shared media folder
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir)
      }
      if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir)
      }

      // Track duplicate titles
      const titleCounter: {[key: string]: number} = {}
      let success: {success: boolean; message: string} = {
        success: true,
        message: exportDir,
      }

      for (const {title, markdown} of documents) {
        const {markdownContent, mediaFiles} = markdown

        // Generate a camelCase filename for the markdown document
        const camelTitle = title
          .split(' ')
          .map(
            (word) =>
              word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
          )
          .join('')
          .replace(/[\/\\|]/g, '-') // Remove invalid characters: / \ |
          .replace(/\s+/g, '') // Remove all whitespace for camel case

        // Initialize counter for the title if not present
        if (!titleCounter[camelTitle]) {
          titleCounter[camelTitle] = 0
        }

        let markdownFilePath = path.join(exportDir, `${camelTitle}.md`)

        // Check if file with the same name already exists and add a counter to the file name
        while (fs.existsSync(markdownFilePath)) {
          titleCounter[camelTitle] += 1
          markdownFilePath = path.join(
            exportDir,
            `${camelTitle}-${titleCounter[camelTitle]}.md`,
          )
        }

        let updatedMarkdownContent = markdownContent

        const uploadMediaFile = async ({
          url,
          filename,
          placeholder,
        }: {
          url: string
          filename: string
          placeholder: string
        }) => {
          return new Promise<void>((resolve, reject) => {
            const regex = /ipfs:\/\/(.+)/
            const match = url.match(regex)
            if (match) {
              const cid = match[1]
              const request = net.request(`${DAEMON_HTTP_URL}/ipfs/${cid}`)

              request.on('response', (response) => {
                const mimeType = response.headers['content-type']
                const extension = Array.isArray(mimeType)
                  ? mime.getExtension(mimeType[0])
                  : mime.getExtension(mimeType)
                const filenameWithExt = `${filename}.${extension}`

                if (response.statusCode === 200) {
                  const chunks: Buffer[] = []

                  response.on('data', (chunk) => {
                    chunks.push(chunk)
                  })

                  response.on('end', () => {
                    const data = Buffer.concat(chunks)
                    if (!data || data.length === 0) {
                      reject(`Error: No data received for ${filenameWithExt}`)
                      return
                    }

                    const mediaFilePath = path.join(mediaDir, filenameWithExt)
                    try {
                      fs.writeFileSync(mediaFilePath, data)
                      debug(`Media file successfully saved: ${mediaFilePath}`)
                      // Update the markdown content with the correct file name
                      updatedMarkdownContent = updatedMarkdownContent.replace(
                        placeholder,
                        filenameWithExt,
                      )
                      resolve()
                    } catch (e) {
                      reject(e)
                    }
                  })
                } else {
                  reject(`Error: Invalid status code ${response.statusCode}`)
                }
              })

              request.on('error', (err) => {
                reject(err.message)
              })

              request.end()
            }
          })
        }

        // Handle all media files for the current document
        await Promise.all(mediaFiles.map(uploadMediaFile))

        // Save the updated markdown file
        try {
          fs.writeFileSync(markdownFilePath, updatedMarkdownContent)
          debug(`Markdown file successfully saved: ${markdownFilePath}`)
        } catch (e) {
          error(`Error saving markdown file: ${markdownFilePath}`, e)
          success = {
            success: false,
            message: `Error saving document: ${title}`,
          }
        }
      }

      if (success.success) {
        event.sender.send('export-completed', {
          success: true,
          message: success.message,
        })
      } else {
        event.sender.send('export-completed', {
          success: false,
          message: success.message,
        })
      }
    } else {
      event.sender.send('export-completed', {
        success: false,
        message: 'Export has been cancelled.',
      })
    }
  },
)

ipcMain.on('open-directory', (_event, directory: string) => {
  shell.openPath(directory)
})
ipcMain.on('open-external-link', (_event, linkUrl) => {
  shell.openExternal(linkUrl)
})

ipcMain.on('quit_app', () => {
  app.quit()
})

ipcMain.on('open_path', (event, path) => {
  shell.openPath(path)
})

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  logger.debug('[MAIN]: Another Seed already running. Quitting..')
  app.quit()
} else {
  app.on('ready', () => {
    logger.debug('[MAIN]: Seed ready')
    openInitialWindows()
  })
  app.on('second-instance', handleSecondInstance)

  app.on('window-all-closed', () => {
    logger.debug('[MAIN]: window-all-closed')
    globalShortcut.unregisterAll()
    if (process.platform != 'darwin') {
      logger.debug('[MAIN]: will quit the app')
      app.quit()
    }
  })
  app.on('open-url', (_event, url) => {
    handleUrlOpen(url)
  })
  app.on('activate', () => {
    logger.debug('[MAIN]: Seed Active (activate)')
    if (BrowserWindow.getAllWindows().length === 0) {
      logger.debug('[MAIN]: no windows found. will open the home window')
      trpc.createAppWindow({
        routes: [defaultRoute],
      })
    }
  })
}
