import {hmId} from '@shm/shared'
import {useTx} from '@shm/shared/translation'
import {SizableText} from '@shm/ui/text'
import type {SiteDocumentPayload} from './loaders'
import {NavigationLoadingContent} from './providers'
import {WebSiteHeader} from './web-site-header'

export function NotFoundPage({
  id,
  homeMetadata,
  originHomeId,
  origin,
  isLatest,
}: SiteDocumentPayload) {
  const tx = useTx()

  return (
    <div className="flex h-screen w-screen flex-col">
      <WebSiteHeader
        siteHomeId={hmId(id.uid)}
        noScroll={false}
        homeMetadata={homeMetadata}
        originHomeId={originHomeId}
        docId={id}
        origin={origin}
        isLatest={isLatest}
      />
      <NavigationLoadingContent className="flex flex-1 items-start justify-center px-4 py-12">
        <div className="border-border dark:bg-background flex w-full max-w-lg flex-1 flex-col gap-4 rounded-lg border bg-white p-6 shadow-lg">
          <SizableText size="3xl">☹️</SizableText>
          <SizableText size="2xl" weight="bold">
            {tx('Document Not Found')}
          </SizableText>

          <SizableText asChild>
            <p>
              {tx(
                'oops_document_not_found',
                `Oops! The document you're looking for doesn't seem to exist. It
              may have been moved, deleted, or the link might be incorrect.`,
              )}
            </p>
          </SizableText>
          <SizableText asChild>
            <p>
              {tx(
                'please_double_check_url',
                `Please double-check the URL or head back to the dashboard to find
              what you're looking for. If you need help, feel free to reach out
              to support.`,
              )}
            </p>
          </SizableText>
        </div>
      </NavigationLoadingContent>
    </div>
  )
}
