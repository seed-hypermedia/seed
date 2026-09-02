import {app, Menu, MenuItemConstructorOptions, nativeImage, Tray} from 'electron'
import {openRoute} from './app-api'
import {
  countActiveServices,
  listServices,
  restartService,
  ServiceInfo,
  startService,
  stopService,
  subscribeServices,
} from './app-services'
import {TRAY_ICON_PNG_1X_BASE64, TRAY_ICON_PNG_2X_BASE64} from './app-tray-icon'
import * as log from './logger'

/**
 * Menu-bar presence for the service manager. The tray lists every service with its state and
 * offers start/stop/restart without opening a window; on macOS the icon also shows how many
 * services are running. Rebuilt whenever the service manager reports a change.
 */

let tray: Tray | null = null

function trayImage() {
  const image = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_1X_BASE64, 'base64'), {scaleFactor: 1})
  image.addRepresentation({scaleFactor: 2, buffer: Buffer.from(TRAY_ICON_PNG_2X_BASE64, 'base64')})
  image.setTemplateImage(true)
  return image
}

function statusGlyph(service: ServiceInfo): string {
  switch (service.runtime.status) {
    case 'running':
      return '●'
    case 'stopping':
      return '◐'
    case 'failed':
      return '✕'
    default:
      return '○'
  }
}

function statusLabel(service: ServiceInfo): string {
  const {runtime} = service
  switch (runtime.status) {
    case 'running':
      return `Running (pid ${runtime.pid ?? '?'})`
    case 'stopping':
      return 'Stopping…'
    case 'failed':
      return runtime.error ? `Failed: ${runtime.error}` : 'Failed'
    case 'exited':
      return `Exited (code ${runtime.exitCode ?? 0})`
    default:
      return 'Stopped'
  }
}

function run(label: string, action: () => unknown) {
  return () => {
    Promise.resolve()
      .then(action)
      .catch((error) => log.error(`[TRAY] ${label} failed`, {error: (error as Error).message}))
  }
}

function serviceMenu(service: ServiceInfo): MenuItemConstructorOptions {
  const active = service.runtime.status === 'running' || service.runtime.status === 'stopping'
  return {
    label: `${statusGlyph(service)} ${service.name}`,
    submenu: [
      {label: statusLabel(service), enabled: false},
      {label: service.command, enabled: false},
      {type: 'separator'},
      {label: 'Start', enabled: !active, click: run('start', () => startService(service.id))},
      {label: 'Stop', enabled: active, click: run('stop', () => stopService(service.id))},
      {label: 'Restart', enabled: active, click: run('restart', () => restartService(service.id))},
      {type: 'separator'},
      {
        label: 'Show Logs',
        click: run('open logs', () => openRoute({key: 'services', serviceId: service.id})),
      },
    ],
  }
}

function buildMenu(): Menu {
  const services = listServices()
  const running = countActiveServices()
  const summary = services.length
    ? `${running} of ${services.length} service${services.length === 1 ? '' : 's'} running`
    : 'No services yet'
  const template: MenuItemConstructorOptions[] = [
    {label: summary, enabled: false},
    {type: 'separator'},
    ...services.map(serviceMenu),
    ...(services.length ? [{type: 'separator'} as MenuItemConstructorOptions] : []),
    {label: 'Open Services…', click: run('open services', () => openRoute({key: 'services'}))},
    {type: 'separator'},
    {label: 'Quit Seed', click: () => app.quit()},
  ]
  return Menu.buildFromTemplate(template)
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return
  const running = countActiveServices()
  tray.setContextMenu(buildMenu())
  tray.setToolTip(running ? `Seed Services: ${running} running` : 'Seed Services')
  if (process.platform === 'darwin') {
    tray.setTitle(running ? String(running) : '')
  }
}

/** Creates the tray icon (once) and keeps its menu in sync with the service manager. */
export function createServicesTray(): Tray | null {
  if (tray) return tray
  try {
    tray = new Tray(trayImage())
  } catch (error) {
    log.error('[TRAY] could not create tray', {error: (error as Error).message})
    return null
  }
  refreshTray()
  subscribeServices((event) => {
    if (event.type === 'services') refreshTray()
  })
  log.info('[TRAY] created')
  return tray
}

/** Removes the tray icon. */
export function destroyServicesTray(): void {
  tray?.destroy()
  tray = null
}
