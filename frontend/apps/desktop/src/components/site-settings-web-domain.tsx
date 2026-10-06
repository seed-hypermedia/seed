import {HostedSiteSettings} from '@/components/hosted-site-settings'
import {usePublishSite, useRemoveSiteDialog} from '@/components/publish-site'
import {roleCanWrite, useSelectedAccountCapability} from '@/models/access-control'
import {useHostSession} from '@/models/host'
import {useOpenUrl} from '@/open-url'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hostnameStripProtocol} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {CloudOff, UploadCloud} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {ExternalLink} from 'lucide-react'

/** Site settings tab for publishing the space to a web domain, and removing it from one. */
export function WebDomainSettings({siteId}: {siteId: UnpackedHypermediaId}) {
  const resource = useResource(siteId, {subscribed: true})
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const capability = useSelectedAccountCapability(siteId)
  const host = useHostSession({includeSites: true})
  const pendingDomain = host.pendingDomains?.find((pending) => pending.siteUid === siteId.uid)
  const publishSite = usePublishSite()
  const removeSiteDialog = useRemoveSiteDialog()
  const openUrl = useOpenUrl()

  if (resource.isInitialLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }
  if (!document) {
    return <SizableText color="muted">This account doesn't have a space yet.</SizableText>
  }

  const heading = (
    <SizableText size="2xl" weight="bold">
      Web Domain
    </SizableText>
  )
  if (!roleCanWrite(capability?.role)) {
    return (
      <>
        {heading}
        <SizableText color="muted">Only editors of the space can change its web domain.</SizableText>
      </>
    )
  }

  const siteUrl = document.metadata.siteUrl
  if (!siteUrl) {
    return (
      <>
        {heading}
        <SizableText color="muted">
          This space is not published to a web domain yet. Publish it to make it available to anyone with a browser.
        </SizableText>
        <Button variant="default" className="self-start" onClick={() => publishSite.open({id: siteId})}>
          Publish to Web Domain
          <UploadCloud className="size-4" />
        </Button>
        {publishSite.content}
      </>
    )
  }

  // A custom domain can replace the free subdomain of the hosting service.
  const canPublishCustomDomain =
    host.loggedIn &&
    host.sites.data?.some((site) => site.activeConfig?.registeredAccountUid === siteId.uid && site.url === siteUrl) &&
    !pendingDomain
  return (
    <>
      {heading}
      <div className="flex flex-col gap-2">
        <SizableText weight="medium">Published at</SizableText>
        <Button variant="outline" className="self-start" onClick={() => openUrl(siteUrl)}>
          {hostnameStripProtocol(siteUrl)}
          <ExternalLink className="size-4" />
        </Button>
        {pendingDomain ? (
          <SizableText size="xs" color="muted">
            Setting up {pendingDomain.hostname}…
          </SizableText>
        ) : null}
      </div>
      <HostedSiteSettings siteId={siteId} siteUrl={siteUrl} />
      {canPublishCustomDomain ? (
        <div className="flex flex-col gap-2">
          <SizableText weight="medium">Custom domain</SizableText>
          <SizableText size="sm" color="muted">
            Publish this space to a domain that you own.
          </SizableText>
          <Button
            variant="default"
            className="self-start"
            onClick={() => publishSite.open({id: siteId, step: 'seed-host-custom-domain'})}
          >
            Publish Custom Domain
            <UploadCloud className="size-4" />
          </Button>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <SizableText weight="medium">Remove domain</SizableText>
        <SizableText size="sm" color="muted">
          The space stays on the Hypermedia network. It is no longer available at this domain.
        </SizableText>
        <Button variant="destructive" className="self-start" onClick={() => removeSiteDialog.open(siteId)}>
          Remove Domain from Publication
          <CloudOff className="size-4" />
        </Button>
      </div>
      {publishSite.content}
      {removeSiteDialog.content}
    </>
  )
}
