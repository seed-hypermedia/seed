import {Download} from 'lucide-react'

export default function GetStarted() {
  return (
    <section className="w-full py-20 bg-white">
      <div className="max-w-6xl px-6 mx-auto">
        {/* Heading and button */}
        <div className="flex flex-col items-center justify-between gap-4 mb-12 md:flex-row">
          <h2 className="w-full text-2xl font-bold text-left text-gray-900 md:text-3xl md:w-auto">
            It's Time To Get Started!
          </h2>
          <a
            href="https://seed.hyper.media/hm/download"
            target="_blank"
            className={`inline-flex items-center px-5 py-2 bg-brand-4 text-white rounded-md hover:bg-brand-3 transition plausible-event-name=download plausible-event-os=${
              navigator.platform.toLowerCase().includes('mac')
                ? 'macos'
                : navigator.platform.toLowerCase().includes('win')
                ? 'windows'
                : 'linux'
            }`}
          >
            <Download size={17} className="mr-2" />
            Download the Seed App
          </a>
        </div>

        {/* <ResourceCards /> */}
      </div>
    </section>
  )
}

// function ResourceCards() {
//   // This should be fetching real documents
//   const cards = new Array(4).fill(null);

//   return (
//     <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
//       {cards.map((_, i) => (
//         <div
//           key={i}
//           className="flex flex-col overflow-hidden bg-white border border-gray-200 rounded-lg shadow-md"
//         >
//           {/* Image placeholder */}
//           <div className="w-full bg-gray-200 h-28" />

//           {/* Text content */}
//           <div className="flex flex-col justify-between flex-1 p-4 text-left">
//             <div>
//               <p className="text-sm font-semibold text-gray-800">
//                 Title Of Document
//               </p>
//               <p className="mt-1 text-xs text-gray-500 line-clamp-3">
//                 Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
//                 eiusmod tempor incididunt ut labore et dolore magna aliqua.
//               </p>
//             </div>
//           </div>

//           {/* Footer */}
//           <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-500 bg-gray-100">
//             <span>Last Updated</span>
//             <div className="flex -space-x-2">
//               <div className="w-5 h-5 bg-gray-300 border border-white rounded-full" />
//               <div className="w-5 h-5 bg-gray-300 border border-white rounded-full" />
//               <div className="w-5 h-5 bg-black rounded-full text-[10px] text-white flex items-center justify-center font-medium">
//                 +1
//               </div>
//             </div>
//           </div>
//         </div>
//       ))}
//     </div>
//   );
// }
