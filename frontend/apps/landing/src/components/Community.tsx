import communityVideo from '../../public/community.mp4'

export default function Community() {
  return (
    <section className="w-full bg-white pt-5 pb-20">
      <div className="mx-auto flex h-full max-w-5xl flex-col items-center justify-between gap-10 px-6 md:flex-row">
        {/* Text Content */}
        <div className="max-w-md flex-1">
          <h2 className="text-3xl font-bold text-gray-900">
            Community Preservation
          </h2>
          <p className="mt-4 text-base text-gray-700">
            Thanks to the local-first architecture, your knowledge is archived
            at your fingertips always there to search and retrieve.
          </p>
        </div>

        {/* Video */}
        <div className="flex-1 overflow-hidden rounded-xl">
          <video
            src={communityVideo}
            autoPlay
            muted
            loop
            playsInline
            className="h-auto max-h-72 w-full md:max-h-80 lg:max-h-96"
          />
        </div>
      </div>
    </section>
  )
}
