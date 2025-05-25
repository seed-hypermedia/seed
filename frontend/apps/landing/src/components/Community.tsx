import communityVideo from "../../public/community.mp4";

export default function Community() {
  return (
    <section className="w-full pt-5 pb-20 bg-white">
      <div className="h-full max-w-5xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-10">
        {/* Text Content */}
        <div className="flex-1 max-w-md">
          <h2 className="text-3xl font-bold text-gray-900">
            Community Preservation
          </h2>
          <p className="mt-4 text-gray-700 text-base">
            Thanks to the local-first architecture, your knowledge is archived
            at your fingertips always there to search and retrieve.
          </p>
        </div>

        {/* Video */}
        <div className="flex-1 rounded-xl overflow-hidden">
          <video
            src={communityVideo}
            autoPlay
            muted
            loop
            playsInline
            className="w-full h-auto max-h-72 md:max-h-80 lg:max-h-96"
          />
        </div>
      </div>
    </section>
  );
}
