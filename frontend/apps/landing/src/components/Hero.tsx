import {Download} from 'lucide-react'
import appDemoVideo from '../../public/app-demo.mp4'
import DiscordIcon from '../assets/DiscordIcon'

export default function Hero() {
  return (
    <section className="w-full px-4 py-16 text-center bg-white">
      <div className="max-w-4xl mx-auto mb-12">
        <h1 className="text-3xl font-bold leading-tight text-gray-900 md:text-5xl">
          Humanity Deserves A{' '}
          <span className="text-brand-5">Better Medium</span> <br />
          For <span className="text-brand-5">Thinking</span> And{' '}
          <span className="text-brand-5">Communication</span>
        </h1>
        <p className="max-w-2xl pt-3 mx-auto mt-5 mb-5 text-xl text-gray-700">
          Your website should be a dynamic space for ideas, projects, and
          community building.
        </p>
        <div className="flex justify-center gap-4">
          <a
            href="https://seed.hyper.media/hm/download"
            target="_blank"
            className={`inline-flex items-center px-5 py-2 bg-brand-4 text-white rounded-md hover:bg-brand-3 transition plausible-event-name=download plausible-event-os=${
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
            className={`inline-flex items-center px-5 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-700 transition plausible-event-name=discord`}
          >
            <DiscordIcon className="w-6 h-6 mr-2 text-white" />
            Join Community Discord
          </a>
        </div>
      </div>

      <div className="max-w-5xl mx-auto overflow-hidden shadow-lg rounded-xl">
        <video
          src={appDemoVideo}
          autoPlay
          muted
          loop
          playsInline
          className="object-contain w-full h-auto"
        />
      </div>
    </section>
  )
}
