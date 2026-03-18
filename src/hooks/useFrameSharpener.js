/**
 * Applies an unsharp-mask sharpening pass to a video frame on an offscreen canvas.
 * Returns the OffscreenCanvas (or regular canvas) ready to be passed to pose detection.
 *
 * Kernel (3×3 sharpen / unsharp mask):
 *   [ 0, -1,  0]
 *   [-1,  5, -1]
 *   [ 0, -1,  0]
 */

const KERNEL = [
   0, -1,  0,
  -1,  5, -1,
   0, -1,  0,
];

export function sharpenFrame(video, width, height, sharpCanvas) {
  const ctx = sharpCanvas.getContext('2d', { willReadFrequently: true });
  sharpCanvas.width = width;
  sharpCanvas.height = height;

  // Draw raw frame
  ctx.drawImage(video, 0, 0, width, height);

  const src = ctx.getImageData(0, 0, width, height);
  const dst = ctx.createImageData(width, height);
  const s = src.data;
  const d = dst.data;
  const w = width;
  const h = height;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;

      for (let c = 0; c < 3; c++) {
        let val = 0;
        // 3×3 neighbourhood
        val += KERNEL[0] * s[((y - 1) * w + (x - 1)) * 4 + c];
        val += KERNEL[1] * s[((y - 1) * w +  x     ) * 4 + c];
        val += KERNEL[2] * s[((y - 1) * w + (x + 1)) * 4 + c];
        val += KERNEL[3] * s[(y       * w + (x - 1)) * 4 + c];
        val += KERNEL[4] * s[(y       * w +  x     ) * 4 + c];
        val += KERNEL[5] * s[(y       * w + (x + 1)) * 4 + c];
        val += KERNEL[6] * s[((y + 1) * w + (x - 1)) * 4 + c];
        val += KERNEL[7] * s[((y + 1) * w +  x     ) * 4 + c];
        val += KERNEL[8] * s[((y + 1) * w + (x + 1)) * 4 + c];
        d[i + c] = Math.max(0, Math.min(255, val));
      }
      d[i + 3] = 255; // alpha
    }
  }

  // Copy border pixels unmodified
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      d[x * 4 + c] = s[x * 4 + c];
      d[((h - 1) * w + x) * 4 + c] = s[((h - 1) * w + x) * 4 + c];
    }
  }
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 4; c++) {
      d[(y * w) * 4 + c] = s[(y * w) * 4 + c];
      d[(y * w + w - 1) * 4 + c] = s[(y * w + w - 1) * 4 + c];
    }
  }

  ctx.putImageData(dst, 0, 0);
  return sharpCanvas;
}