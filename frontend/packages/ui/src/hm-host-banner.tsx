import {hostnameStripProtocol} from '@shm/shared'

export function HypermediaHostBanner({origin}: {origin?: string}) {
  return (
    <div className="bg-primary w-full p-1">
      <p className="flex flex-wrap items-center justify-center gap-1 text-sm text-white">
        <span>Hosted on</span>
        <a href="/" className="underline">
          {hostnameStripProtocol(origin)}
        </a>
        <span>via the</span>
        <a href="https://hyper.media" target="_blank" className="underline">
          Hypermedia Protocol
        </a>
      </p>
    </div>
  )
}
