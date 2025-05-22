import publishingDemoVideo from "../../media/publishing-demo.mp4";

export default function Publishing() {
  return (
    <section className="w-full px-4 py-20 bg-green-fade-to text-center">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 text-left">
          Your Publications With No Barriers
        </h2>
        <p className="mt-4 text-gray-600 text-lg text-left">
          Publish your content freely and effortlessly — no barriers, no limits.
        </p>

        <div className="mt-12 grid gap-6 sm:grid-cols-1 md:grid-cols-3">
          {[
            {
              title: "Quick & Easy Publishing",
              points: ["No coding required.", "No gatekeepers.", "No hassle."],
            },
            {
              title: "Publish Freely, Without Censorship",
              points: [
                "All you need is a computer.",
                "Share your ideas, stories, and creations without restrictions.",
              ],
            },
            {
              title: "Portable & Shareable",
              points: [
                "Publish directly to your own domain or hyper.media.",
                "Instantly share your work with friends, followers, and the world.",
              ],
            },
          ].map((card, i) => (
            <div
              key={i}
              className="bg-brand-5 text-white p-6 rounded-xl text-left shadow-md"
            >
              <h3 className="text-lg font-semibold mb-3">{card.title}</h3>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {card.points.map((pt, idx) => (
                  <li key={idx}>{pt}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Demo Video */}
        <div className="mt-16 w-full mx-auto overflow-hidden rounded-xl shadow-md">
          <video
            src={publishingDemoVideo}
            autoPlay
            muted
            loop
            playsInline
            className="w-full h-auto"
          />
        </div>
      </div>
    </section>
  );
}
