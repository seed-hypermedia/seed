/**
 * Native confirmation shown for every `sign.*` bridge call
 * (docs/extensions/design.md §4.1, §6). Names the extension, the site, the
 * account that will sign, and what exactly is being signed. Approve resolves
 * the handler's promise; Deny or closing the dialog rejects with
 * `user_rejected`. The "allow for this session" checkbox is returned to the
 * caller, which keeps the in-memory session allow list.
 */

import {ExtensionError} from '@seed-hypermedia/client/extensions'
import {useCallback, useId, useMemo, useRef, useState, type ReactNode} from 'react'
import {Button} from '../button'
import {Checkbox} from '../components/checkbox'
import {Label} from '../components/label'
import {Text} from '../text'
import {useAppDialog} from '../universal-dialog'
import {shortId} from './host-utils'

export type SignConfirmMetadataChange = {key: string; before: unknown; after: unknown}

export type SignConfirmDetail =
  | {
      kind: 'comment'
      /** `hm://` id of the target document. */
      targetId: string
      targetName?: string
      targetPath: string
      /** Plain-text preview of the comment body. */
      preview: string
      isReply: boolean
    }
  | {
      kind: 'document'
      /** `hm://` id of the document (without version). */
      id: string
      name?: string
      /** Whether the document exists (false → it will be created). */
      exists: boolean
      summary?: string
      /** Whether the request carried a `metadata` object (so "no metadata changes" can be shown). */
      metadataRequested?: boolean
      /** Only keys whose value actually differs from the published document. */
      metadataChanges: SignConfirmMetadataChange[]
      replaceBody: boolean
      blockCount: number
    }
  | {
      kind: 'data'
      purpose: string
      byteLength: number
      hexPreview: string
    }

export type SignConfirmRequest = {
  extension: {id: string; name: string; version: string | null}
  site: {uid: string; name?: string}
  account: {accountId: string; name?: string}
  detail: SignConfirmDetail
}

export type SignConfirmResult = {allowSession: boolean}

export type ConfirmSignFn = (request: SignConfirmRequest) => Promise<SignConfirmResult>

type DialogInput = {
  request: SignConfirmRequest
  approve: (result: SignConfirmResult) => void
}

/**
 * Returns `confirmSign` (a promise-returning function the bridge handlers
 * await) and `content` (render it once inside the page tree).
 */
export function useSignConfirmDialog(): {confirmSign: ConfirmSignFn; content: ReactNode} {
  // The promise currently waiting on the dialog, if any. Cleared when settled.
  const pendingRef = useRef<{reject: (error: ExtensionError) => void} | null>(null)

  const onClose = useCallback(() => {
    const pending = pendingRef.current
    pendingRef.current = null
    pending?.reject(new ExtensionError('user_rejected', 'The user rejected the signature request'))
  }, [])

  const dialog = useAppDialog<DialogInput>(SignConfirmDialogContent, {
    onClose,
    className: 'max-w-lg',
  })

  const confirmSign = useCallback<ConfirmSignFn>(
    (request) => {
      // One at a time: a second request while the dialog is open is rejected
      // rather than queued, so an extension cannot pile up prompts.
      if (pendingRef.current) {
        return Promise.reject(new ExtensionError('user_rejected', 'Another signature request is already pending'))
      }
      return new Promise<SignConfirmResult>((resolve, reject) => {
        pendingRef.current = {reject}
        dialog.open({
          request,
          approve: (result) => {
            pendingRef.current = null
            resolve(result)
            dialog.close()
          },
        })
      })
    },
    [dialog],
  )

  return useMemo(() => ({confirmSign, content: dialog.content}), [confirmSign, dialog.content])
}

function SignConfirmDialogContent({input, onClose}: {input: DialogInput; onClose: () => void}) {
  const {request} = input
  const [allowSession, setAllowSession] = useState(false)
  const allowSessionId = useId()
  const title = titleFor(request.detail)

  return (
    <div className="flex flex-col gap-5" data-testid="extension-sign-confirm">
      <div className="flex flex-col gap-1">
        <Text className="text-xl leading-tight font-semibold">{title}</Text>
        <Text className="text-muted-foreground text-sm">
          An extension is asking to sign with your account. Review the details before approving.
        </Text>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <Row label="Extension">
          <span className="font-medium">{request.extension.name}</span>{' '}
          <span className="text-muted-foreground break-all">({request.extension.id})</span>
        </Row>
        <Row label="Site">
          <span className="font-medium">{request.site.name || 'Untitled site'}</span>{' '}
          <span className="text-muted-foreground">({shortId(request.site.uid)})</span>
        </Row>
        <Row label="Signing as">
          <span className="font-medium">{request.account.name || 'Unnamed account'}</span>{' '}
          <span className="text-muted-foreground">({shortId(request.account.accountId)})</span>
        </Row>
      </dl>

      <DetailBody detail={request.detail} />

      <div className="flex items-center gap-3">
        <Checkbox
          id={allowSessionId}
          checked={allowSession}
          onCheckedChange={(v) => setAllowSession(v === true)}
          data-testid="extension-sign-allow-session"
        />
        <Label htmlFor={allowSessionId}>Allow this extension to sign for the rest of this session</Label>
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onClose} data-testid="extension-sign-deny">
          Deny
        </Button>
        <Button variant="brand" onClick={() => input.approve({allowSession})} data-testid="extension-sign-approve">
          Approve
        </Button>
      </div>
    </div>
  )
}

function titleFor(detail: SignConfirmDetail): string {
  switch (detail.kind) {
    case 'comment':
      return detail.isReply ? 'Publish a reply?' : 'Publish a comment?'
    case 'document':
      return detail.exists ? 'Publish a document change?' : 'Create a document?'
    case 'data':
      return 'Sign data?'
  }
}

function Row({label, children}: {label: string; children: ReactNode}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

function DetailBody({detail}: {detail: SignConfirmDetail}) {
  if (detail.kind === 'comment') {
    return (
      <Section title={detail.isReply ? 'Reply on' : 'Comment on'}>
        <Text className="text-sm font-medium">{detail.targetName || 'Untitled document'}</Text>
        <Text className="text-muted-foreground text-xs break-all">{detail.targetPath || '/'}</Text>
        <pre className="bg-muted mt-2 max-h-40 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
          {detail.preview || '(empty)'}
        </pre>
      </Section>
    )
  }
  if (detail.kind === 'document') {
    return (
      <Section title={detail.exists ? 'Change to' : 'New document'}>
        <Text className="text-sm font-medium">{detail.name || detail.id}</Text>
        <Text className="text-muted-foreground text-xs break-all">{detail.id}</Text>
        {detail.summary ? <Text className="mt-2 text-sm">{detail.summary}</Text> : null}
        {detail.metadataRequested && detail.metadataChanges.length === 0 ? (
          <Text className="text-muted-foreground mt-2 text-xs">No metadata changes</Text>
        ) : null}
        {detail.metadataChanges.length > 0 ? (
          <div className="mt-2 flex flex-col gap-1">
            <Text className="text-muted-foreground text-xs font-medium uppercase">Metadata</Text>
            <ul className="bg-muted max-h-40 overflow-auto rounded-md p-3 text-xs">
              {detail.metadataChanges.map((c) => (
                <li key={c.key} className="flex flex-col gap-0.5 py-1">
                  <span className="font-mono font-medium">{c.key}</span>
                  <span className="text-muted-foreground line-through">{formatValue(c.before)}</span>
                  <span>{formatValue(c.after)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {detail.replaceBody ? (
          <Text className="mt-2 text-sm">
            The document body will be replaced with {detail.blockCount} block{detail.blockCount === 1 ? '' : 's'}.
          </Text>
        ) : null}
      </Section>
    )
  }
  return (
    <Section title="Data to sign">
      <Text className="text-sm">{detail.purpose}</Text>
      <Text className="text-muted-foreground mt-1 text-xs">
        {detail.byteLength} byte{detail.byteLength === 1 ? '' : 's'}
      </Text>
      <pre className="bg-muted mt-2 overflow-auto rounded-md p-3 font-mono text-xs break-all whitespace-pre-wrap">
        {detail.hexPreview || '(empty)'}
      </pre>
      <Text className="text-muted-foreground mt-2 text-xs">
        The signature is domain-separated with the extension id; it cannot be used as a hypermedia blob.
      </Text>
    </Section>
  )
}

function Section({title, children}: {title: string; children: ReactNode}) {
  return (
    <div className="border-border flex flex-col rounded-lg border p-3">
      <Text className="text-muted-foreground mb-1 text-xs font-medium uppercase">{title}</Text>
      {children}
    </div>
  )
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(unset)'
  if (value === null) return '(deleted)'
  if (typeof value === 'string') return value || '(empty)'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
