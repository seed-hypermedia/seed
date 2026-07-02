import type {PluginManifest, PluginPermission} from '@shm/ui/plugin-manifest'
import {PLUGIN_CALL_TIMEOUT_MS, PLUGIN_IFRAME_SANDBOX, PLUGIN_SHIM_HTML, type ShimToHostMessage} from './plugin-shim'

/**
 * Host side of the plugin sandbox (see docs/plugins/design.md §2). One
 * PluginHost per enabled plugin: a hidden sandboxed iframe (created lazily),
 * one Worker per invocation inside it, MessageChannel RPC, and per-call
 * deadlines with hard termination.
 *
 * The host is UI-framework-free; a React wrapper owns its lifecycle.
 */

/**
 * Permission-checked capability surface the bridge provides to plugins.
 * Implementations live in plugin-bridge.ts; the host only routes and
 * enforces the manifest's declared permissions.
 */
export type PluginBridge = {
  call(method: string, params: unknown, context: {manifest: PluginManifest}): Promise<unknown>
  /** Which permission (if any) a method requires. Unknown methods reject. */
  requiredPermission(method: string): PluginPermission | 'unknown-method' | null
}

type PendingCall = {
  resolve: (output: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

let callSeq = 0

export class PluginHost {
  private iframe: HTMLIFrameElement | null = null
  private port: MessagePort | null = null
  private ready: Promise<void> | null = null
  private pending = new Map<string, PendingCall>()

  constructor(
    readonly manifest: PluginManifest,
    private readonly code: string,
    private readonly bridge: PluginBridge,
    private readonly container: HTMLElement = document.body,
    private readonly timeoutMs: number = PLUGIN_CALL_TIMEOUT_MS,
  ) {}

  /** Spawn the sandbox iframe and complete the port handshake. Idempotent. */
  private ensureReady(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      const iframe = document.createElement('iframe')
      // Order matters: sandbox must be set before srcdoc so the document
      // never exists unsandboxed.
      iframe.setAttribute('sandbox', PLUGIN_IFRAME_SANDBOX)
      iframe.style.display = 'none'
      iframe.setAttribute('aria-hidden', 'true')
      const channel = new MessageChannel()
      const timeout = setTimeout(() => {
        this.destroy()
        reject(new Error('Plugin sandbox failed to start'))
      }, 10_000)
      channel.port1.onmessage = (event: MessageEvent<ShimToHostMessage>) => {
        const message = event.data
        if (message?.type === 'shim-ready') {
          clearTimeout(timeout)
          resolve()
          return
        }
        this.handleShimMessage(message)
      }
      iframe.addEventListener('load', () => {
        // The shim is our own static document; the handshake transfers the
        // port so all further traffic is unforgeable.
        iframe.contentWindow?.postMessage('seed-plugin-bootstrap', '*', [channel.port2])
      })
      iframe.srcdoc = PLUGIN_SHIM_HTML
      this.container.appendChild(iframe)
      this.iframe = iframe
      this.port = channel.port1
    })
    return this.ready
  }

  private handleShimMessage(message: ShimToHostMessage | undefined) {
    if (!message) return
    if (message.type === 'result' || message.type === 'error') {
      const pending = this.pending.get(message.callId)
      if (!pending) return
      this.pending.delete(message.callId)
      clearTimeout(pending.timeout)
      if (message.type === 'result') pending.resolve(message.output)
      else pending.reject(new Error(message.message))
      return
    }
    if (message.type === 'bridge-call') {
      void this.handleBridgeCall(message.callId, message.rpcId, message.method, message.params)
    }
  }

  /** Permission gate + bridge dispatch for a capability call from the sandbox. */
  private async handleBridgeCall(callId: string, rpcId: string, method: string, params: unknown) {
    const respond = (result?: unknown, error?: string) =>
      this.port?.postMessage({type: 'bridge-response', callId, rpcId, result, error})
    const needed = this.bridge.requiredPermission(method)
    if (needed === 'unknown-method') {
      respond(undefined, `Unknown method: ${method}`)
      return
    }
    if (needed && !(this.manifest.permissions ?? []).includes(needed)) {
      respond(undefined, `Permission denied: ${method} requires "${needed}" (declare it in the plugin manifest)`)
      return
    }
    try {
      respond(await this.bridge.call(method, params, {manifest: this.manifest}))
    } catch (error) {
      respond(undefined, error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Invoke an action. Resolves with the plugin's output or rejects on plugin
   * error / deadline (the worker is hard-terminated either way).
   */
  async invoke(action: string, input: unknown, opts?: {timeoutMs?: number}): Promise<unknown> {
    await this.ensureReady()
    const callId = `call${++callSeq}`
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.pending.delete(callId)
          this.port?.postMessage({type: 'cancel', callId})
          reject(new Error(`Plugin action timed out after ${opts?.timeoutMs ?? this.timeoutMs}ms`))
        },
        opts?.timeoutMs ?? this.timeoutMs,
      )
      this.pending.set(callId, {resolve, reject, timeout})
      this.port?.postMessage({type: 'invoke', callId, code: this.code, action, input})
    })
  }

  /** Tear down the sandbox entirely; pending calls reject. */
  destroy() {
    this.pending.forEach((pending) => {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Plugin host destroyed'))
    })
    this.pending.clear()
    this.port?.close()
    this.port = null
    this.iframe?.remove()
    this.iframe = null
    this.ready = null
  }
}
