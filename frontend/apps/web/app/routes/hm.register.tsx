import {defaultPageMeta} from '@/meta'
import {SizableText} from '@shm/ui/text'

export const loader = async ({request}: {request: Request}) => {
  return null
}

export const meta = defaultPageMeta('Site Registration')

export default function RegisterPage() {
  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="flex flex-1 items-start justify-center px-4 py-12">
        <div className="border-border dark:bg-background flex w-full max-w-lg flex-0 flex-1 flex-col gap-4 rounded-lg border bg-white p-6 shadow-lg">
          <SizableText size="5xl">🚀</SizableText>
          <SizableText size="2xl" weight="bold">
            Secret Site Setup Link
          </SizableText>

          <SizableText asChild>
            <p>
              <b>Your Seed Hypermedia Site is Ready to be Deployed!</b>
            </p>
          </SizableText>
          <SizableText asChild>
            <p>
              From your publication or account page within the Seed Hypermedia
              app, click the dropdown in the top right corner and select
              "Publish Site". Then, paste the URL of this page into the dialog
              box, and click Publish!
            </p>
          </SizableText>
          <SizableText asChild>
            <p>
              Then your content will be published to this site. Your account
              will be registered in this domain, so all future content in your
              publication will be sent here and published to the web.
            </p>
          </SizableText>
          <SizableText asChild>
            <p>
              <b>Warning:</b> You should keep this URL a secret, otherwise
              somebody else might publish their content here before you do.
            </p>
          </SizableText>
        </div>
      </div>
    </div>
  )
}
