import {createHMUrl} from "@shm/shared";
import {Copy, ExternalLink} from "lucide-react";
import {useRootDocuments} from "../models";
import {copyToClipboardWithToast} from "../utils/clipboard";

export default function List() {
  const {data, isLoading} = useRootDocuments();
  return (
    <div className="w-full p-6 bg-white rounded-lg shadow">
      <h1 className="mb-4 text-3xl font-bold text-gray-900">
        All Hypermedia Sites
      </h1>
      {isLoading && <p>Loading...</p>}
      {data && (
        <div className="space-y-2">
          {data.documents.map((doc) => {
            const url = createHMUrl(doc.id);
            return (
              <a
                key={doc.id.id}
                href={`/hm/${doc.id.uid}/${doc.id.path?.join("/") || ""}`}
                className="flex items-center justify-between p-4 border rounded-lg cursor-pointer hover:bg-gray-50 group"
              >
                <span className="font-medium">
                  {doc.metadata?.name || "Untitled"}
                </span>
                <div className="flex items-center space-x-2 transition-opacity opacity-0 group-hover:opacity-100">
                  <button
                    className="relative p-2 rounded-full hover:bg-gray-100 group/button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      copyToClipboardWithToast(url);
                    }}
                  >
                    <Copy className="w-4 h-4" />
                    <span className="absolute px-2 py-1 mb-2 text-xs text-white transition-opacity -translate-x-1/2 bg-gray-900 rounded opacity-0 bottom-full left-1/2 group-hover/button:opacity-100 whitespace-nowrap">
                      Copy URL
                    </span>
                  </button>
                  <button
                    className="relative p-2 rounded-full hover:bg-gray-100 group/button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      window.open(url, "_blank");
                    }}
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span className="absolute px-2 py-1 mb-2 text-xs text-white transition-opacity -translate-x-1/2 bg-gray-900 rounded opacity-0 bottom-full left-1/2 group-hover/button:opacity-100 whitespace-nowrap">
                      Open in new tab
                    </span>
                  </button>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
