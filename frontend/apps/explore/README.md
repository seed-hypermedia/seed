# Hypermedia Explorer

Browse the data on the Hypermedia network


## Development

### Prerequisites

- Node.js (v16+)
- Yarn

### Setup

1. Install dependencies:

   ```bash
   yarn install
   ```

2. Start the development server:

   ```bash
   yarn dev
   ```

3. Build for production:
   ```bash
   yarn build
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
yarn
yarn dev
```

## Deploy

```
cd frontend/apps/explore
yarn
yarn build
# the build is in frontend/apps/explore/dist
```
