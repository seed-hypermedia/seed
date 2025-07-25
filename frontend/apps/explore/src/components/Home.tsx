import {Loader} from "lucide-react";
import {FormEvent, useState} from "react";
import {useNavigate} from "react-router-dom";
import {search} from "../models";

export default function Home() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSearch = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!url) return;

    setErrorMessage(null);
    setIsLoading(true);
    search(url)
      .then((result) => {
        if (result.destination) {
          setErrorMessage(null);
          navigate(result.destination);
        } else {
          setErrorMessage(result.errorMessage || "Unknown error");
        }
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  return (
    <div className="container p-4 mx-auto bg-white rounded-lg shadow max-w-2xl">
      <h1 className="mb-4 text-3xl font-bold text-gray-900">
        Explore Hypermedia
      </h1>
      <p className="mb-6 text-gray-600">
        Enter a URL to explore the Hypermedia network. Supports hm://, ipfs://,
        and http(s):// URLS of hypermedia documents.
      </p>

      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter URL to explore..."
            className="flex-1 p-4 text-base border border-gray-300 rounded-lg sm:rounded-l-lg sm:rounded-r-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={isLoading || !url}
            className="flex items-center justify-center gap-2 px-6 py-4 text-base font-semibold text-white bg-blue-600 rounded-lg sm:rounded-l-none sm:rounded-r-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors min-h-[56px]"
          >
            {isLoading ? <Loader className="w-5 h-5 animate-spin" /> : "Search"}
          </button>
        </div>
      </form>

      {errorMessage && (
        <div className="p-4 mt-4 text-red-600 border border-red-200 rounded-lg bg-red-50">
          <h2 className="mb-2 text-xl font-semibold">Error</h2>
          <p>{errorMessage}</p>
        </div>
      )}
    </div>
  );
}
