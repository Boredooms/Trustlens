import { describe, expect, it } from "vitest";
import { PHASH_SIZE, dct2d, hammingDistance, phashFromGray, rgbaToGray, validateLogoFile } from "./phash";

const N = PHASH_SIZE;
const image = (f: (x: number, y: number) => number) => {
  const a = new Float64Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) a[y * N + x] = f(x, y);
  return a;
};
const vertical = image((x) => (x < N / 2 ? 0 : 255));
const horizontal = image((_, y) => (y < N / 2 ? 0 : 255));
// Off-centre shapes: a perfectly symmetric one has many exactly-zero coefficients.
const circle = image((x, y) => ((x - 11) ** 2 + (y - 13) ** 2 < 64 ? 30 : 220) - (x > 24 && y < 6 ? 120 : 0));

describe("pHash", () => {
  it("is 16 lowercase hex chars and deterministic", () => {
    const h = phashFromGray(circle);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(phashFromGray(circle)).toBe(h);
    expect(phashFromGray(Float64Array.from(circle))).toBe(h);
  });

  it("ignores uniform brightness changes and survives small noise", () => {
    const brighter = circle.map((v) => Math.min(255, v + 20));
    expect(hammingDistance(phashFromGray(circle), phashFromGray(brighter))).toBeLessThanOrEqual(2);
    let seed = 7;
    const noisy = circle.map((v) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return v + ((seed % 9) - 4);
    });
    expect(hammingDistance(phashFromGray(circle), phashFromGray(noisy))).toBeLessThanOrEqual(6);
  });

  it("separates different shapes", () => {
    expect(hammingDistance(phashFromGray(vertical), phashFromGray(horizontal))).toBeGreaterThan(10);
    expect(hammingDistance(phashFromGray(vertical), phashFromGray(circle))).toBeGreaterThan(10);
  });

  it("DCT of a flat image has energy only in the DC term", () => {
    const c = dct2d(image(() => 100));
    expect(c[0]![0]).toBeCloseTo(100 * N, 6);
    expect(Math.abs(c[0]![1]!)).toBeLessThan(1e-9);
    expect(Math.abs(c[3]![5]!)).toBeLessThan(1e-9);
    expect(() => dct2d([1, 2, 3])).toThrow();
  });

  it("reads RGBA as luma with transparency over white", () => {
    expect(Array.from(rgbaToGray([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 0]))).toEqual([255, 0, 255]);
  });

  it("validates logo files", () => {
    expect(validateLogoFile({ type: "image/png", size: 1000 })).toBeNull();
    expect(validateLogoFile({ type: "image/gif", size: 1000 })).toMatch(/PNG, JPEG or SVG/);
    expect(validateLogoFile({ type: "image/svg+xml", size: 2 * 1024 * 1024 })).toMatch(/1 MB/);
  });
});
