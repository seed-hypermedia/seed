import appDemoVideo from "../../media/app-demo.mp4";

export default function Hero() {
  return (
    <section className="w-full px-4 py-16 text-center bg-white">
      <div className="max-w-4xl mx-auto mb-12">
        <h1 className="text-3xl md:text-5xl font-bold text-gray-900 leading-tight">
          Humanity Deserves A{" "}
          <span className="text-brand-5">Better Medium</span> <br />
          For <span className="text-brand-5">Thinking</span> And{" "}
          <span className="text-brand-5">Communication</span>
        </h1>
        <p className="mt-5 max-w-2xl mx-auto text-xl pt-3 text-gray-700">
          Your website should be a dynamic space for ideas, projects, and
          community building.
        </p>
        <a
          href="https://seed.hyper.media/hm/download"
          target="_blank"
          className={`mt-8 inline-block text-brand-5 font-semibold px-6 py-2 rounded-md transition plausible-event-name=download plausible-event-os=${
            navigator.platform.toLowerCase().includes("mac")
              ? "macos"
              : navigator.platform.toLowerCase().includes("win")
              ? "windows"
              : "linux"
          }`}
        >
          Download the Seed App
        </a>
      </div>

      <div className="max-w-5xl mx-auto shadow-lg rounded-xl overflow-hidden">
        <video
          src={appDemoVideo}
          autoPlay
          muted
          loop
          playsInline
          className="w-full h-auto object-contain"
        />
      </div>
    </section>
  );
}
