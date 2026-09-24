import {app, BrowserWindow} from 'electron'
import {setupWebBrowser} from '../../src/app-web-browser'

app.setPath('userData', process.argv[5])
app.commandLine.appendSwitch('host-resolver-rules', 'MAP seed-rebinding.test 127.0.0.1')
void app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {preload: process.argv[4], webviewTag: true, contextIsolation: true, sandbox: true},
  })
  setupWebBrowser(
    window,
    () => true,
    async () => ({id: 'fixture-archive-draft'}),
  )
  await window.loadFile(process.argv[3])
})
