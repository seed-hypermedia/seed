import {createHMUrl, hmIdPathToEntityQueryPath} from "@shm/shared";
import {Copy, ExternalLink} from "lucide-react";
import {copyToClipboardWithToast} from "../../utils/clipboard";

export function DocumentListItem({doc, apiHost}: {doc: any; apiHost: string}) {
  const url = createHMUrl(doc.id);
  let webUrl = `${apiHost}/hm/${doc.id.type}/${
    doc.id.uid
  }${hmIdPathToEntityQueryPath(doc.id.path)}`;
  if (doc.id.version) {
    webUrl += `?v=${doc.id.version}`;
  }
  return (
    <a
      key={doc.id.id}
      href={`/hm/${doc.id.uid}/${doc.id.path?.join("/") || ""}`}
      className="flex items-center justify-between p-4 bg-white border rounded-lg cursor-pointer hover:bg-gray-50 group"
    >
      <span className="font-medium">
        {doc.metadata?.name || doc.id.path?.at(-1) || "Untitled"}
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
            window.open(webUrl, "_blank");
          }}
        >
          <ExternalLink className="w-4 h-4" />
          <span className="absolute px-2 py-1 mb-2 text-xs text-white transition-opacity -translate-x-1/2 bg-gray-900 rounded opacity-0 bottom-full left-1/2 group-hover/button:opacity-100 whitespace-nowrap">
            Open in new tab
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
          <ExternalLink className="w-4 h-4 text-green-500" />
          <span className="absolute px-2 py-1 mb-2 text-xs text-white transition-opacity -translate-x-1/2 bg-gray-900 rounded opacity-0 bottom-full left-1/2 group-hover/button:opacity-100 whitespace-nowrap">
            Open in Seed App
          </span>
        </button>
      </div>
    </a>
  );
}
