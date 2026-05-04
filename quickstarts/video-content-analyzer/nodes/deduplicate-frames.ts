import type { Context } from "tentacular";
import { decode as decodeJpeg } from "npm:jpeg-js@0.4.4";
import type { ExtractFramesOutput } from "./extract-frames.ts";

export interface DeduplicateFramesOutput {
  frames: string[];
  original_count: number;
  deduplicated_count: number;
  removed_count: number;
  title: string;
  context_prompt: string;
}

/**
 * Deduplicate extracted frames using perceptual hashing (blockhash).
 * Consecutive frames with hamming distance below threshold are dropped.
 * Typical reduction: 300 raw frames from a 1-hour talk -> 40-80 unique frames.
 */
export default async function run(
  ctx: Context,
  input: unknown,
): Promise<DeduplicateFramesOutput> {
  const data = input as ExtractFramesOutput;
  const cfg = ctx.config as Record<string, unknown>;
  const dedupCfg = (cfg["dedup"] as Record<string, unknown>) ?? {};
  const threshold = Number(dedupCfg["hamming_threshold"] ?? 10);

  ctx.log.info(
    `Deduplicating ${data.count} frames (hamming threshold=${threshold})`,
  );

  const kept: string[] = [];
  let prevHash: Uint8Array | null = null;

  for (const framePath of data.frames) {
    const bytes = await Deno.readFile(framePath);
    const hash = blockhash(bytes);

    if (prevHash === null || hammingDistance(prevHash, hash) >= threshold) {
      kept.push(framePath);
      prevHash = hash;
    }
  }

  const removed = data.count - kept.length;
  ctx.log.info(
    `Kept ${kept.length} of ${data.count} frames (removed ${removed} near-duplicates)`,
  );

  return {
    frames: kept,
    original_count: data.count,
    deduplicated_count: kept.length,
    removed_count: removed,
    title: data.title,
    context_prompt: data.context_prompt,
  };
}

/**
 * Compute a 256-bit blockhash from JPEG bytes.
 * Algorithm: decode JPEG, resize to 16x16 by block-averaging,
 * convert to grayscale, compare each pixel to the median.
 */
function blockhash(jpegBytes: Uint8Array): Uint8Array {
  const { data, width, height } = decodeJpeg(jpegBytes, {
    useTArray: true,
    formatAsRGBA: true,
  });

  const bits = 16;
  const pixels = new Float64Array(bits * bits);

  // Block-average into 16x16 grid
  const blockW = width / bits;
  const blockH = height / bits;

  for (let by = 0; by < bits; by++) {
    for (let bx = 0; bx < bits; bx++) {
      let sum = 0;
      let count = 0;
      const startY = Math.floor(by * blockH);
      const endY = Math.floor((by + 1) * blockH);
      const startX = Math.floor(bx * blockW);
      const endX = Math.floor((bx + 1) * blockW);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * width + x) * 4;
          // Luminance: 0.299R + 0.587G + 0.114B
          sum += data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
          count++;
        }
      }
      pixels[by * bits + bx] = count > 0 ? sum / count : 0;
    }
  }

  // Median
  const sorted = Float64Array.from(pixels).sort();
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  // Build hash: 256 bits = 32 bytes
  const hash = new Uint8Array(32);
  for (let i = 0; i < 256; i++) {
    if (pixels[i] >= median) {
      hash[i >> 3] |= 1 << (7 - (i & 7));
    }
  }

  return hash;
}

/** Hamming distance between two 32-byte hashes (0-256). */
function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  let dist = 0;
  for (let i = 0; i < 32; i++) {
    let xor = a[i] ^ b[i];
    while (xor) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}
