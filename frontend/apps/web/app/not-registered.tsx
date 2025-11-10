import {Link} from '@remix-run/react'
import {SizableText} from '@shm/ui/text'
import {Container} from './ui/container'

export function NotRegisteredPage({}: {}) {
  return (
    <div>
      <Container>
        <div className="border-border w-full max-w-xl gap-5 self-center rounded-md border p-5 shadow-md">
          <div className="flex items-center gap-3">
            <SizableText size="3xl">🚧</SizableText>
            <SizableText size="2xl" weight="bold">
              Seed Hypermedia Site Coming Soon
            </SizableText>
          </div>
          <div>
            <SizableText>
              Welcome! We're excited to have you onboard. It looks like your
              content has not been published to this new site.
            </SizableText>
            <SizableText className="mt-3">
              To complete your setup, please follow the remaining steps from
              your secret setup URL. Reach out to the Seed Hypermedia team if
              you need any help.
            </SizableText>
          </div>
        </div>
      </Container>
    </div>
  )
}

export function NoSitePage({}: {}) {
  return (
    <div>
      <Container>
        <div className="border-border w-full max-w-xl gap-5 self-center rounded-md border p-5 shadow-md">
          <div className="flex items-center gap-3">
            <SizableText size="3xl">☁️</SizableText>
            <SizableText size="2xl" weight="bold">
              Nothing Here, (yet!)
            </SizableText>
          </div>
          <div>
            <SizableText>
              You can create Hypermedia content and publish it to your network
              for free by{' '}
              <Link to="https://seed.hyper.media/hm/download">
                downloading the Seed Hypermedia app
              </Link>
              .
            </SizableText>
            <SizableText className="mt-3">
              To publish something here,{' '}
              <Link to="https://discord.com/invite/xChFt8WPN8">
                join our Discord server
              </Link>{' '}
              and ask about our hosting service. If you have a domain and a
              server, you can also{' '}
              <Link to="https://seed.hyper.media/resources/self-host-seed">
                self-host your site
              </Link>
              .
            </SizableText>
          </div>
        </div>
      </Container>
    </div>
  )
}
