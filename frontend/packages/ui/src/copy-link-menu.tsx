import {Globe, Link, Link2} from 'lucide-react'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import type {MenuItemType} from './options-dropdown'

type CopyAction = (() => Promise<void> | void) | null | undefined

type CopyChoice = {
  label?: string
  copy: CopyAction
}

function hasHttpScheme(value: string) {
  return value.startsWith('http://') || value.startsWith('https://')
}

/** Returns the origin to use when copying a web gateway link from browser UI. */
export function getWebCopyLinkHostname(origin?: string | null) {
  if (origin && hasHttpScheme(origin)) return origin
  const currentOrigin =
    typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
      ? window.location.origin
      : null
  if (currentOrigin && hasHttpScheme(currentOrigin)) return currentOrigin
  return origin ?? DEFAULT_GATEWAY_URL
}

export type CopyLinkMenuOptions = {
  advanced?: boolean
  label?: string
  iconClassName?: string
  canonical?: CopyChoice | null
  gateway?: CopyChoice | null
  hypermedia: {
    label?: string
    copy: Exclude<CopyAction, null | undefined>
  }
}

/**
 * Copies the most user-friendly available document link.
 * Preference order is canonical/site URL, then gateway/web URL, then hm:// URL.
 */
export async function copyBestAvailableLink({
  canonical,
  gateway,
  hypermedia,
}: {
  canonical?: CopyAction
  gateway?: CopyAction
  hypermedia: Exclude<CopyAction, null | undefined>
}) {
  if (canonical) {
    await canonical()
    return
  }
  if (gateway) {
    await gateway()
    return
  }
  await hypermedia()
}

/** Builds the Copy Link menu item in simple or advanced mode. */
export function createCopyLinkMenuItem({
  advanced,
  label = 'Copy Link',
  iconClassName = 'size-4',
  canonical,
  gateway,
  hypermedia,
}: CopyLinkMenuOptions): MenuItemType {
  const canonicalCopy = canonical?.copy
  const gatewayCopy = gateway?.copy
  const hypermediaCopy = hypermedia.copy

  if (advanced) {
    const children: MenuItemType[] = []
    if (canonicalCopy) {
      children.push({
        key: 'copy-canonical',
        label: canonical.label ?? 'Copy Canonical URL',
        icon: <Globe className={iconClassName} />,
        onClick: async (e) => {
          e?.stopPropagation()
          await canonicalCopy()
        },
      })
    }
    if (gatewayCopy) {
      children.push({
        key: 'copy-gateway',
        label: gateway.label ?? 'Copy Gateway URL',
        icon: <Link className={iconClassName} />,
        onClick: async (e) => {
          e?.stopPropagation()
          await gatewayCopy()
        },
      })
    }
    children.push({
      key: 'copy-hm',
      label: hypermedia.label ?? 'Copy Hypermedia URL',
      icon: <Link2 className={iconClassName} />,
      onClick: async (e) => {
        e?.stopPropagation()
        await hypermediaCopy?.()
      },
    })

    return {
      key: 'copy-link',
      label,
      icon: <Link className={iconClassName} />,
      children,
    }
  }

  return {
    key: 'copy-link',
    label,
    icon: <Link className={iconClassName} />,
    onClick: async (e) => {
      e?.stopPropagation()
      await copyBestAvailableLink({
        canonical: canonicalCopy,
        gateway: gatewayCopy,
        hypermedia: hypermediaCopy,
      })
    },
  }
}
