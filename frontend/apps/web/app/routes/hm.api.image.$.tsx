import {LoaderFunction} from "@remix-run/node";
import {DAEMON_FILE_URL} from "@shm/shared";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

const CACHE_PATH = path.resolve(
  path.join(process.env.DATA_DIR || process.cwd(), "image-cache")
);
const IMG_SIZE_WIDTHS: Record<string, number> = {
  S: 100,
  M: 250,
  L: 900,
};

export const loader: LoaderFunction = async ({params, request}) => {
  const entityPath = params["*"]?.split("/");
  const CID = entityPath?.[0];
  const url = new URL(request.url);
  const size = url.searchParams.get("size") || "M";

  if (!CID) {
    return new Response("No CID provided", {status: 400});
  }
  if (!IMG_SIZE_WIDTHS[size]) {
    return new Response(
      `Invalid size, must be ${Object.keys(IMG_SIZE_WIDTHS).join(", ")}`,
      {status: 400}
    );
  }

  const cacheFilePath = path.join(CACHE_PATH, `${CID}.${size}.png`);

  try {
    // Check if cached file exists
    const cachedFile = await fs.stat(cacheFilePath);
    if (cachedFile) {
      return new Response(await fs.readFile(cacheFilePath), {
        headers: {"Content-Type": "image/png"},
      });
    }
  } catch (err) {
    // File does not exist, proceed to download and resize
  }

  try {
    // Fetch the original image from the daemon
    const imageUrl = `${DAEMON_FILE_URL}/${CID}`;
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from ${imageUrl}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    // Resize the image
    const resizedImage = await sharp(imageBuffer)
      .resize({width: IMG_SIZE_WIDTHS[size]})
      .png()
      .toBuffer();

    // Ensure the cache directory exists
    await fs.mkdir(CACHE_PATH, {recursive: true});

    // Write the resized image to the cache
    await fs.writeFile(cacheFilePath, resizedImage);

    // Serve the resized image
    return new Response(resizedImage, {
      headers: {"Content-Type": "image/png"},
    });
  } catch (error) {
    console.error(error);
    return new Response("Failed to process image", {status: 500});
  }
};
