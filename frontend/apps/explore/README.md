# Hypermedia Explorer

Browse the data on the Hypermedia network

## Development

### Prerequisites

- Node.js (v16+)
- pnpm

### Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Start the development server:

   ```bash
   pnpm dev
   ```

3. Build for production:
   ```bash
   pnpm build
   ```

## Environment Variables

The app uses the following environment variables:

- `VITE_PUBLIC_EXPLORE_API_HOST`: The default API host URL (defaults to http://localhost:3000)

You can customize these by creating a `.env` file in the root directory.

## Settings

The app includes a settings panel accessible via the gear icon in the lower left corner. You can configure:

- Explore API Host: The URL of the API server

```
cd frontend/apps/explore
pnpm install
pnpm dev
```

## Deploy

```
cd frontend/apps/explore
pnpm install
pnpm build
# the build is in frontend/apps/explore/dist
```
