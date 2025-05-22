import collaboratorsImage from "../../media/collaborators.png";
import commentsImage from "../../media/comments.png";
export default function Collaboration() {
  return (
    <section className="w-full py-20 bg-green-fade-from">
      <div className="max-w-5xl mx-auto px-6">
        <div className="mb-16">
          <h2 className="text-3xl font-bold text-gray-900">
            Distributed Collaboration
          </h2>
          <p className="mt-4 text-gray-700 max-w-lg">
            Once you publish, build deep knowledge by sparking open discussions.
          </p>
        </div>

        <div className="relative pb-16">
          {/* Horizontal Separator */}
          <div className="w-full border-t border-gray-200 mb-10" />
          <div className="flex flex-col md:flex-row gap-12">
            {/* Column 1 */}
            <div className="flex-1 pt-6 pr-10">
              <h3 className="text-lg font-semibold text-gray-900">
                Collaborative Documents
              </h3>
              <p className="mt-2 text-gray-700 max-w-[320px] min-h-[56px]">
                Engage with your community by inviting readers and collaborators
                to your site.
              </p>
              <img
                src={collaboratorsImage}
                alt="Collaborative Documents"
                className="mt-4 w-full h-[400px] object-contain"
              />
            </div>

            {/* Vertical Divider */}
            <div className="hidden md:block w-px bg-gray-200 absolute left-1/2 inset-y-0 transform -translate-x-1/2" />

            {/* Column 2 */}
            <div className="flex-1 pt-6 pl-10">
              <h3 className="text-lg font-semibold text-gray-900">
                Open Discussions
              </h3>
              <p className="mt-2 text-gray-700 max-w-[320px] min-h-[56px]">
                Connect directly peer-to-peer, with no centralized control.
              </p>
              <img
                src={commentsImage}
                alt="Open Discussions"
                className="mt-4 w-full h-[400px] object-contain"
              />
            </div>
          </div>
        </div>
        {/* Horizontal Separator */}
        <div className="w-full border-t border-gray-200" />
      </div>
    </section>
  );
}
