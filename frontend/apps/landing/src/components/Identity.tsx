import checkImage from "../../public/check.png";
import encryptionVideo from "../../public/encryption.mp4";
import keyImage from "../../public/key.png";

export default function Identity() {
  return (
    <section className="w-full px-4 md:px-8 py-14 md:py-20 bg-[#fdfdfd]">
      {/* Own Your Identity Block */}
      <div className="max-w-5xl mx-auto">
        {/* <div className="grid grid-cols-1 md:grid-cols-3 gap-10 items-center max-w-3/4"> */}
        <div className="flex flex-col md:flex-row items-center gap-10 max-w-5xl mx-auto">
          <div className="flex-1 self-start md:self-center mt-8">
            <h2 className="text-4xl font-bold text-gray-900">
              Own Your Identity
            </h2>
            <p className="mt-4 text-gray-700">
              Control your credentials—secure, decentralized, and independent of
              central authorities.
            </p>
          </div>

          <div className="flex flex-col items-center text-center flex-1">
            <img
              src={keyImage}
              alt="Crypto sign"
              className="max-h-24 max-w-24 mb-1"
            />
            <p className="text-sm text-gray-600 max-w-[180px]">
              Content is cryptographically signed, so anyone can verify
              authenticity.
            </p>
          </div>

          <div className="flex flex-col items-center text-center flex-1">
            <img
              src={checkImage}
              alt="ID check"
              className="max-h-24 max-w-24 mb-1"
            />
            <p className="text-sm text-gray-600 max-w-[250px]">
              Your identity is validated with your social graph and domain
              names, forming a robust web of trust.
            </p>
          </div>
        </div>
      </div>

      {/* Separator */}
      <div className="my-16 border-t border-gray-200 w-full max-w-5xl mx-auto" />

      {/* Signed Versions Block */}
      <div className="max-w-5xl mx-auto text-center">
        <h3 className="text-2xl md:text-3xl font-semibold text-gray-900">
          Signed Versions
        </h3>
        <p className="mt-4 text-gray-700">
          Each change is cryptographically signed by the author. Leveraging the
          power of IPFS and CRDTs, each immutable version may be accurately
          referenced.
        </p>
        <p className="mt-2 text-gray-700">
          By delivering permanence, attribution, and versioning to the web, you
          can preserve the history of your community's knowledge.
        </p>

        {/* Video */}
        <div className="mt-10">
          <video
            src={encryptionVideo}
            autoPlay
            muted
            loop
            playsInline
            className="w-full max-w-3xl mx-auto rounded-xl object-contain"
          />
        </div>
      </div>
    </section>
  );
}
