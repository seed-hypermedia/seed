import {Download} from 'lucide-react'
import appDemoVideo from '../../public/app-demo.mp4'
import DiscordIcon from '../assets/DiscordIcon'

export default function Hero() {
  return (
    <section className="w-full bg-white px-4 py-16 text-center">
      <div className="mx-auto mb-12 max-w-4xl">
        <h1 className="text-3xl leading-tight font-bold text-gray-900 md:text-5xl">
          Humanity Deserves A{' '}
          <span className="text-brand-5">Better Medium</span> <br />
          For <span className="text-brand-5">Thinking</span> And{' '}
          <span className="text-brand-5">Communication</span>
        </h1>
        <p className="mx-auto mt-5 mb-5 max-w-2xl pt-3 text-xl text-gray-700">
          Your website should be a dynamic space for ideas, projects, and
          community building.
        </p>
        <div className="flex justify-center gap-4">
          <a
            href="https://seed.hyper.media/hm/download"
            target="_blank"
            className={`bg-brand-4 hover:bg-brand-3 plausible-event-name=download inline-flex items-center rounded-md px-5 py-2 text-white transition plausible-event-os=${
              navigator.platform.toLowerCase().includes('mac')
                ? 'macos'
                : navigator.platform.toLowerCase().includes('win')
                ? 'windows'
                : 'linux'
            }`}
          >
            <Download size={17} className="mr-2" />
            Download the Seed App
          </a>
          <a
            href="https://discord.gg/mcUnKENdKX"
            target="_blank"
            className={`plausible-event-name=discord inline-flex items-center rounded-md bg-gray-500 px-5 py-2 text-white transition hover:bg-gray-700`}
          >
            <DiscordIcon className="mr-2 h-6 w-6 text-white" />
            Join Community Discord
          </a>
        </div>
      </div>

      <div className="mx-auto max-w-5xl overflow-hidden rounded-xl shadow-lg">
        <video
          src={appDemoVideo}
          autoPlay
          muted
          loop
          playsInline
          className="h-auto w-full object-contain"
        />
      </div>
    </section>
  )
}
