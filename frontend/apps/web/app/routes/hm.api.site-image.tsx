import type {ActionFunction} from "@remix-run/node";
import sharp from "sharp";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const SITE_IMAGE_MAX_SIZE = 512;

export const action: ActionFunction = async ({request}: {request: Request}) => {
  const contentLength = parseInt(request.headers.get("content-length") || "0");
  if (contentLength > MAX_FILE_SIZE) {
    return new Response(
      JSON.stringify({error: "File too large, max size is 10MB"}),
      {
        status: 413,
        headers: {"Content-Type": "application/json"},
      }
    );
  }
  try {
    const arrayBuffer = await request.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    const sharpImage = sharp(imageBuffer);
    const metadata = await sharpImage.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("Invalid image file");
    }
    const size = Math.min(metadata.width, metadata.height);
    const targetSize = size > SITE_IMAGE_MAX_SIZE ? SITE_IMAGE_MAX_SIZE : size;
    const processedImage = await sharpImage
      .resize(size, size, {
        fit: "cover",
        position: "center",
      })
      .resize(targetSize, targetSize, {
        fit: "fill",
      })
      .png()
      .toBuffer();
    return new Response(processedImage, {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": processedImage.length.toString(),
        Signature: "SIG-TODO",
      },
    });
  } catch (error: unknown) {
    return new Response(
      JSON.stringify({
        error: "Invalid image file or processing failed",
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 400,
        headers: {"Content-Type": "application/json"},
      }
    );
  }
};
