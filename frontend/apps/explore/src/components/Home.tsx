import {Loader} from 'lucide-react'
import {FormEvent, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {search} from '../models'

export default function Home() {
  const [url, setUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const navigate = useNavigate()

  const handleSearch = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!url) return

    setErrorMessage(null)
    setIsLoading(true)
    search(url)
      .then((result) => {
        if (result.destination) {
          setErrorMessage(null)
          navigate(result.destination)
        } else {
          setErrorMessage(result.errorMessage || 'Unknown error')
        }
      })
      .finally(() => {
        setIsLoading(false)
      })
  }

  return (
    <div className="container mx-auto max-w-2xl rounded-lg bg-white p-4 shadow">
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
            className="flex-1 rounded-lg border border-gray-300 p-4 text-base focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none sm:rounded-l-lg sm:rounded-r-none"
          />
          <button
            type="submit"
            disabled={isLoading || !url}
            className="flex min-h-[56px] items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-4 text-base font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 sm:rounded-l-none sm:rounded-r-lg"
          >
            {isLoading ? <Loader className="h-5 w-5 animate-spin" /> : 'Search'}
          </button>
        </div>
      </form>

      {errorMessage && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-600">
          <h2 className="mb-2 text-xl font-semibold">Error</h2>
          <p>{errorMessage}</p>
        </div>
      )}
    </div>
  )
}
