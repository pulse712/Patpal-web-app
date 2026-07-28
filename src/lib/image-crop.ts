/** Banner display ratio used on the home page (width : height). */
export const BANNER_ASPECT = 2.4;

/** Exported banner dimensions — keeps file size reasonable on web. */
export const BANNER_OUTPUT_WIDTH = 1200;
export const BANNER_OUTPUT_HEIGHT = 500;

export type CropArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", reject);
    img.crossOrigin = "anonymous";
    img.src = src;
  });
}

/** Render cropped region to a JPEG blob sized for promo banners. */
export async function getCroppedBannerBlob(
  imageSrc: string,
  crop: CropArea,
  mimeType: "image/jpeg" | "image/webp" = "image/jpeg",
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = BANNER_OUTPUT_WIDTH;
  canvas.height = BANNER_OUTPUT_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare image canvas.");

  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    BANNER_OUTPUT_WIDTH,
    BANNER_OUTPUT_HEIGHT,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not export cropped image."));
      },
      mimeType,
      0.88,
    );
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
