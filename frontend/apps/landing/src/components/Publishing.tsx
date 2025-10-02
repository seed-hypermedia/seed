import publishingDemoVideo from '../../public/publishing-demo.mp4'

export default function Publishing() {
  return (
    <section className="w-full bg-[linear-gradient(to_bottom,_#038e7a1a_0%,_#038e7a00_33%)] px-4 py-20 text-center">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-left text-3xl font-bold text-gray-900 md:text-4xl">
          Your Publications With No Barriers
        </h2>
        <p className="mt-4 text-left text-lg text-gray-600">
          Publish your content freely and effortlessly — no barriers, no limits.
        </p>

        <div className="mt-12 grid gap-6 sm:grid-cols-1 md:grid-cols-3">
          {[
            {
              title: 'Quick & Easy Publishing',
              points: ['No coding required.', 'No gatekeepers.', 'No hassle.'],
            },
            {
              title: 'Publish Freely, Without Censorship',
              points: [
                'All you need is a computer.',
                'Share your ideas, stories, and creations without restrictions.',
              ],
            },
            {
              title: 'Portable & Shareable',
              points: [
                'Publish directly to your own domain or hyper.media.',
                'Instantly share your work with friends, followers, and the world.',
              ],
            },
          ].map((card, i) => (
            <div
              key={i}
              className="bg-brand-5 rounded-xl p-6 text-left text-white shadow-md"
            >
              <h3 className="mb-3 text-lg font-semibold">{card.title}</h3>
              <ul className="list-inside list-disc space-y-1 text-sm">
                {card.points.map((pt, idx) => (
                  <li key={idx}>{pt}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Demo Video */}
        <div className="mx-auto mt-16 w-full overflow-hidden rounded-xl shadow-md">
          <video
            src={publishingDemoVideo}
            autoPlay
            muted
            loop
            playsInline
            className="h-auto w-full"
          />
        </div>
      </div>
    </section>
  )
}
