export default function Linking() {
  return (
    <section className="w-full py-20 bg-[linear-gradient(to_bottom,_#e5f4ee_1%,_#fefefe_30%)]">
      <div className="max-w-5xl mx-auto px-6">
        {/* Heading */}
        <div className="text-left mb-16">
          <h2 className="text-3xl font-bold text-gray-900">
            Powerful Links And Embeds
          </h2>
          <p className="mt-4 text-gray-700 max-w-lg">
            Unlock the full potential of your content with advanced linking and
            embedding features.
          </p>
        </div>

        <div className="relative pb-16">
          {/* Horizontal Separator */}
          <div className="w-full border-t border-gray-200 mb-10" />
          <div className="flex flex-col md:flex-row gap-12">
            {/* Column 1 */}
            <div className="flex-1 pt-6 pr-10">
              <h3 className="text-lg font-semibold text-gray-900">
                Precise Linking
              </h3>
              <p className="mt-2 text-gray-700 max-w-sm">
                Build precise knowledge structures by linking directly to
                specific sections, paragraphs, or even individual words.
              </p>
              <img
                src="/linking.png"
                alt="Precise Linking"
                className="mt-4 w-full h-auto rounded-xl"
              />
            </div>

            {/* Vertical Divider */}
            <div className="hidden md:block w-px bg-gray-200 absolute left-1/2 inset-y-0 transform -translate-x-1/2" />

            {/* Column 2 */}
            <div className="flex-1 pt-6 pl-10">
              <h3 className="text-lg font-semibold text-gray-900">
                Bi-Directional References
              </h3>
              <p className="mt-2 text-gray-700 max-w-sm">
                All references are bi-directional, allowing you to explore other
                perspectives by tracking links back to your content.
              </p>
              <img
                src="/referencing.png"
                alt="References"
                className="mt-4 w-full h-auto rounded-xl"
              />
            </div>
          </div>
        </div>

        {/* Horizontal Separator */}
        <div className="w-full border-t border-gray-200" />

        {/* Bottom Video Block */}
        <div className="text-left mt-10">
          <h3 className="text-3xl font-semibold text-gray-900">
            Seamless Embeds
          </h3>
          <p className="mt-5 text-gray-700 max-w-xl">
            Embed external content into your site while preserving proper
            attribution, keeping your resources organized and accessible.
          </p>
          <div className="mt-6 overflow-hidden w-full ">
            <video
              src="/embeds.mp4"
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-auto object-contain"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
