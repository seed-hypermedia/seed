import embedsVideo from '../../public/embeds.mp4'
import linkingImage from '../../public/linking.png'
import referencingImage from '../../public/referencing.png'

export default function Linking() {
  return (
    <section className="w-full bg-[linear-gradient(to_bottom,_#e5f4ee_0%,_#fefefe_33%)] py-20">
      <div className="mx-auto max-w-5xl px-6">
        {/* Heading */}
        <div className="mb-16 text-left">
          <h2 className="text-3xl font-bold text-gray-900">
            Powerful Links And Embeds
          </h2>
          <p className="mt-4 max-w-lg text-gray-700">
            Unlock the full potential of your content with advanced linking and
            embedding features.
          </p>
        </div>

        <div className="relative pb-16">
          {/* Horizontal Separator */}
          <div className="mb-10 w-full border-t border-gray-200" />
          <div className="flex flex-col gap-12 md:flex-row">
            {/* Column 1 */}
            <div className="flex-1 pt-6 pr-10">
              <h3 className="text-lg font-semibold text-gray-900">
                Precise Linking
              </h3>
              <p className="mt-2 max-w-sm text-gray-700">
                Build precise knowledge structures by linking directly to
                specific sections, paragraphs, or even individual words.
              </p>
              <img
                src={linkingImage}
                alt="Precise Linking"
                className="mt-4 h-auto w-full rounded-xl"
              />
            </div>

            {/* Vertical Divider */}
            <div className="absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 transform bg-gray-200 md:block" />

            {/* Column 2 */}
            <div className="flex-1 pt-6 pl-10">
              <h3 className="text-lg font-semibold text-gray-900">
                Bi-Directional References
              </h3>
              <p className="mt-2 max-w-sm text-gray-700">
                All references are bi-directional, allowing you to explore other
                perspectives by tracking links back to your content.
              </p>
              <img
                src={referencingImage}
                alt="References"
                className="mt-4 h-auto w-full rounded-xl"
              />
            </div>
          </div>
        </div>

        {/* Horizontal Separator */}
        <div className="w-full border-t border-gray-200" />

        {/* Bottom Video Block */}
        <div className="mt-10 text-left">
          <h3 className="text-3xl font-semibold text-gray-900">
            Seamless Embeds
          </h3>
          <p className="mt-5 max-w-xl text-gray-700">
            Embed external content into your site while preserving proper
            attribution, keeping your resources organized and accessible.
          </p>
          <div className="mt-6 w-full overflow-hidden">
            <video
              src={embedsVideo}
              autoPlay
              muted
              loop
              playsInline
              className="h-auto w-full object-contain"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
