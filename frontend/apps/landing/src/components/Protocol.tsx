import {Github, Glasses} from 'lucide-react'
import protocolVideo from '../../public/protocol.mp4'

export default function Protocol() {
  return (
    <section className="w-full bg-[#efefef] py-20">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-12 px-6 md:flex-row">
        {/* Text Content */}
        <div className="flex-1">
          <h2 className="mb-6 text-3xl font-bold text-gray-900">
            Open Protocol And Software
          </h2>
          <p className="mb-4 text-lg text-gray-800">
            Seed Hypermedia is designed in two parts. Seed is the Open Source
            software developed by our team, while Hypermedia is the open
            protocol that enhances the web to build trust and collaboration.
          </p>
          <p className="mb-4 text-lg text-gray-800">
            Because our desktop app and server are Open Source, developers can
            join our community to expand the product for their needs.
          </p>
          <p className="mb-6 text-lg text-gray-800">
            Anyone can participate in the hypermedia protocol and extend it
            beyond the current capabilities.
          </p>
          <div className="flex gap-4">
            <a
              href="https://github.com/seed-hypermedia"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-brand-4 hover:bg-brand-3 inline-flex items-center rounded-md px-5 py-2 text-white transition"
            >
              <Github size={17} className="mr-2" />
              GitHub
            </a>
            <a
              href="https://explore.hyper.media/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-md bg-gray-500 px-5 py-2 text-white transition hover:bg-gray-700"
            >
              <Glasses size={17} className="mr-2" />
              Protocol Explorer
            </a>
          </div>
        </div>

        {/* Animation Video */}
        <div className="relative flex flex-1 items-center justify-center">
          <div className="relative h-[300px] w-[300px] overflow-hidden md:h-[400px] md:w-[400px]">
            <video
              src={protocolVideo}
              autoPlay
              loop
              muted
              playsInline
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 scale-[2.2] transform object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
