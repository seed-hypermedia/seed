export default function Protocol() {
  return (
    <section className="w-full py-20 bg-[#efefef]">
      <div className="max-w-5xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-12">
        {/* Text Content */}
        <div className="flex-1">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">
            Open Protocol And Software
          </h2>
          <p className="text-lg text-gray-800 mb-4">
            Seed Hypermedia is designed in two parts. Seed is the Open Source software developed by our team, while Hypermedia is the open protocol that enhances the web to build trust and collaboration.
          </p>
          <p className="text-lg text-gray-800 mb-4">
            Because our desktop app and server are Open Source, developers can join our community to expand the product for their needs.
          </p>
          <p className="text-lg text-gray-800 mb-6">
            Anyone can participate in the hypermedia protocol and extend it beyond the current capabilities.
          </p>
          <a
            href="https://github.com/seed-hypermedia"
            target="_blank"
            rel="noopener noreferrer"
            className="text-green-700 font-medium hover:underline"
          >
            GitHub →
          </a>
        </div>

        {/* Animation Video */}
        <div className="relative flex-1 flex justify-center items-center">
          <div className="w-[300px] h-[300px] md:w-[400px] md:h-[400px] overflow-hidden relative">
            <video
              src="/videos/protocol.mp4"
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
  );
}
