/**
 * 64-bit perceptual hash (pHash) of a logo, computed in the browser (ORGANISATION_TRUST_PROFILES.md
 * "Logo (pHash)", R-ID-04). Only the 16-hex-char hash is sent to the API; the image never leaves
 * the device.
 *
 * Algorithm: grayscale → 32×32 → 2D DCT-II → top-left 8×8 coefficients → bit = coefficient >
 * median of the 63 AC coefficients (DC excluded from the median) → 64 bits, most significant first.
 */
export const PHASH_SIZE = 32;
const LOW = 8;
export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"] as const;

/** RGBA pixels (canvas ImageData layout) → luma, ITU-R BT.601 weights; transparent pixels read as white. */
export function rgbaToGray(rgba: ArrayLike<number>): Float64Array {
  const n = Math.floor(rgba.length / 4);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (rgba[i * 4 + 3] ?? 255) / 255;
    const blend = (c: number) => c * a + 255 * (1 - a);
    out[i] = 0.299 * blend(rgba[i * 4] ?? 0) + 0.587 * blend(rgba[i * 4 + 1] ?? 0) + 0.114 * blend(rgba[i * 4 + 2] ?? 0);
  }
  return out;
}

/** 2D DCT-II of a size×size row-major matrix; only the first `keep`×`keep` coefficients. */
export function dct2d(pixels: ArrayLike<number>, size: number = PHASH_SIZE, keep: number = LOW): number[][] {
  if (pixels.length !== size * size) throw new Error(`expected ${size * size} pixels, got ${pixels.length}`);
  const cos: number[][] = [];
  for (let u = 0; u < keep; u++) {
    const row: number[] = [];
    for (let x = 0; x < size; x++) row.push(Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size)));
    cos.push(row);
  }
  const out: number[][] = [];
  for (let u = 0; u < keep; u++) {
    const row: number[] = [];
    for (let v = 0; v < keep; v++) {
      let sum = 0;
      for (let y = 0; y < size; y++) {
        let inner = 0;
        for (let x = 0; x < size; x++) inner += (pixels[y * size + x] ?? 0) * cos[v]![x]!;
        sum += inner * cos[u]![y]!;
      }
      const cu = u === 0 ? Math.SQRT1_2 : 1;
      const cv = v === 0 ? Math.SQRT1_2 : 1;
      row.push((2 / size) * cu * cv * sum);
    }
    out.push(row);
  }
  return out;
}

/** pHash of a 32×32 grayscale image → 16 lowercase hex chars. Pure: same pixels, same hash. */
export function phashFromGray(gray: ArrayLike<number>): string {
  const coeffs = dct2d(gray).flat(); // 64 values, DC first
  // Median of the 63 AC terms: the DC term is overall brightness, which says nothing about shape.
  const sorted = coeffs.slice(1).sort((x, y) => x - y);
  const median = sorted[31]!;
  let hex = "";
  for (let nibble = 0; nibble < 16; nibble++) {
    let v = 0;
    for (let b = 0; b < 4; b++) v = (v << 1) | (coeffs[nibble * 4 + b]! > median ? 1 : 0);
    hex += v.toString(16);
  }
  return hex;
}

/** Bits that differ between two hashes (0 = identical, ≤ 10 usually means "same logo"). */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== 16 || b.length !== 16) throw new Error("expected two 16-hex-char hashes");
  let d = 0;
  for (let i = 0; i < 16; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export function validateLogoFile(file: { type: string; size: number }): string | null {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return "Use a PNG, JPEG or SVG image.";
  if (file.size > LOGO_MAX_BYTES) return "The logo must be 1 MB or smaller.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

/** Browser only: decode the file, draw it at 32×32 and hash it. */
export async function phashFromFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = PHASH_SIZE;
    canvas.height = PHASH_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("This browser cannot read images.");
    ctx.fillStyle = "white"; // transparent logo areas hash as white, matching rgbaToGray
    ctx.fillRect(0, 0, PHASH_SIZE, PHASH_SIZE);
    ctx.drawImage(img, 0, 0, PHASH_SIZE, PHASH_SIZE);
    return phashFromGray(rgbaToGray(ctx.getImageData(0, 0, PHASH_SIZE, PHASH_SIZE).data));
  } finally {
    URL.revokeObjectURL(url);
  }
}
