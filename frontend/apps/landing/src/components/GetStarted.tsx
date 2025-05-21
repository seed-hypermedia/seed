import {Download} from "lucide-react";

export default function GetStarted() {
  return (
    <section className="w-full py-20 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        {/* Heading and button */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 text-left w-full md:w-auto">
            It's Time To Get Started!
          </h2>
          <a
            href="/hm/download"
            target="_blank"
            className="inline-flex items-center px-5 py-2 bg-green-700 text-white rounded-md hover:bg-green-800 transition"
          >
            <Download size={17} className="mr-2" />
            Download the Seed App
          </a>
        </div>

        {/* <ResourceCards /> */}
      </div>
    </section>
  );
}

// function ResourceCards() {
//   // This should be fetching real documents
//   const cards = new Array(4).fill(null);

//   return (
//     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
//       {cards.map((_, i) => (
//         <div
//           key={i}
//           className="rounded-lg shadow-md overflow-hidden bg-white border border-gray-200 flex flex-col"
//         >
//           {/* Image placeholder */}
//           <div className="bg-gray-200 h-28 w-full" />

//           {/* Text content */}
//           <div className="p-4 flex-1 flex flex-col justify-between text-left">
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
//           <div className="px-4 py-2 bg-gray-100 flex justify-between items-center text-xs text-gray-500">
//             <span>Last Updated</span>
//             <div className="flex -space-x-2">
//               <div className="w-5 h-5 bg-gray-300 rounded-full border border-white" />
//               <div className="w-5 h-5 bg-gray-300 rounded-full border border-white" />
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
