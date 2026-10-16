import {app, BrowserWindow} from 'electron'
import {setupWebBrowser} from '../../src/app-web-browser'

app.setPath('userData', process.argv[5])
app.commandLine.appendSwitch(
  'host-resolver-rules',
  'MAP seed-rebinding.test 127.0.0.1, MAP seed-blocked.test 127.0.0.1',
)
void app.whenReady().then(async () => {
  // SEED_E2E_HIDDEN keeps the test window off the developer's screen; hidden windows still paint.
  const hidden = !!process.env.SEED_E2E_HIDDEN
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    show: !hidden,
    paintWhenInitiallyHidden: true,
    webPreferences: {preload: process.argv[4], contextIsolation: true, sandbox: true},
  })
  setupWebBrowser(
    window,
    () => true,
    async () => ({id: 'fixture-archive-draft'}),
  )
  await window.loadFile(process.argv[3])
})
