import {Github, Glasses} from 'lucide-react'
import protocolVideo from '../../public/protocol.mp4'

export default function Protocol() {
  return (
    <section className="w-full py-20 bg-[#efefef]">
      <div className="flex flex-col items-center justify-between max-w-5xl gap-12 px-6 mx-auto md:flex-row">
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
              className="inline-flex items-center px-5 py-2 text-white transition rounded-md bg-brand-4 hover:bg-brand-3"
            >
              <Github size={17} className="mr-2" />
              GitHub
            </a>
            <a
              href="https://explore.hyper.media/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-5 py-2 text-white transition bg-gray-500 rounded-md hover:bg-gray-700"
            >
              <Glasses size={17} className="mr-2" />
              Protocol Explorer
            </a>
          </div>
        </div>

        {/* Animation Video */}
        <div className="relative flex items-center justify-center flex-1">
          <div className="w-[300px] h-[300px] md:w-[400px] md:h-[400px] overflow-hidden relative">
            <video
              src={protocolVideo}
              autoPlay
              loop
              muted
              playsInline
              className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 scale-[2.2] object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
