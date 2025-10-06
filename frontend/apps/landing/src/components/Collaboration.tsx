import collaboratorsImage from '../../public/collaborators.png'
import commentsImage from '../../public/comments.png'

export default function Collaboration() {
  return (
    <section className="w-full bg-[linear-gradient(to_bottom,_#54cd8533_0%,_#54cd8500_33%)] py-20">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900">
            Distributed Collaboration
          </h2>
          <p className="mt-4 max-w-lg text-gray-700">
            Once you publish, build deep knowledge by sparking open discussions.
          </p>
        </div>

        <div className="relative pb-16">
          {/* Horizontal Separator */}
          <div className="mb-10 w-full border-t border-gray-200" />
          <div className="flex flex-col gap-12 md:flex-row">
            {/* Column 1 */}
            <div className="flex-1 pt-6 pr-10">
              <h3 className="text-lg font-semibold text-gray-900">
                Collaborative Documents
              </h3>
              <p className="mt-2 min-h-[56px] max-w-[320px] text-gray-700">
                Engage with your community by inviting readers and collaborators
                to your site.
              </p>
              <img
                src={collaboratorsImage}
                alt="Collaborative Documents"
                className="mt-4 h-[400px] w-full object-contain"
              />
            </div>

            {/* Vertical Divider */}
            <div className="absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 transform bg-gray-200 md:block" />

            {/* Column 2 */}
            <div className="flex-1 pt-6 pl-10">
              <h3 className="text-lg font-semibold text-gray-900">
                Open Discussions
              </h3>
              <p className="mt-2 min-h-[56px] max-w-[320px] text-gray-700">
                Connect directly peer-to-peer, with no centralized control.
              </p>
              <img
                src={commentsImage}
                alt="Open Discussions"
                className="mt-4 h-[400px] w-full object-contain"
              />
            </div>
          </div>
        </div>
        {/* Horizontal Separator */}
        <div className="w-full border-t border-gray-200" />
      </div>
    </section>
  )
}
