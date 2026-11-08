/**
 * Magic-byte detection for the formats we accept (§8.3 step 1). Hand-written
 * rather than `file-type` (ESM-only) — the list is short and fixed.
 */
export type Detected =
  | { kind: 'IMAGE'; mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/tiff' | 'image/heic' | 'image/heif' }
  | { kind: 'RAW'; mime: 'image/x-canon-cr2' | 'image/x-canon-cr3' | 'image/x-tiff-raw' }
  | { kind: 'VIDEO'; mime: 'video/mp4' | 'video/quicktime' | 'video/x-matroska' | 'video/webm' };

const ascii = (b: Buffer, start: number, end: number) => b.subarray(start, end).toString('latin1');

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);
const HEIF_BRANDS = new Set(['mif1', 'msf1', 'heif']);
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'MSNV', 'dash', '3gp4', '3gp5', '3g2a', 'mmp4', 'XAVC', 'f4v ']);

export function sniff(b: Buffer): Detected | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'IMAGE', mime: 'image/jpeg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'IMAGE', mime: 'image/png' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return { kind: 'IMAGE', mime: 'image/webp' };

  const tiffLE = b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00;
  const tiffBE = b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a;
  if (tiffLE || tiffBE) {
    if (tiffLE && ascii(b, 8, 10) === 'CR') return { kind: 'RAW', mime: 'image/x-canon-cr2' };
    return { kind: 'IMAGE', mime: 'image/tiff' }; // NEF/ARW/DNG are TIFF containers too; caller decides by isRaw
  }

  if (ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (brand === 'crx ') return { kind: 'RAW', mime: 'image/x-canon-cr3' };
    if (HEIC_BRANDS.has(brand)) return { kind: 'IMAGE', mime: 'image/heic' };
    if (HEIF_BRANDS.has(brand)) return { kind: 'IMAGE', mime: 'image/heif' };
    if (brand === 'qt  ') return { kind: 'VIDEO', mime: 'video/quicktime' };
    if (MP4_BRANDS.has(brand)) return { kind: 'VIDEO', mime: 'video/mp4' };
    // Compatible brands (offset 16+) for less common major brands.
    const boxSize = b.readUInt32BE(0);
    for (let i = 16; i + 4 <= Math.min(boxSize, b.length); i += 4) {
      const c = ascii(b, i, i + 4);
      if (HEIC_BRANDS.has(c)) return { kind: 'IMAGE', mime: 'image/heic' };
      if (MP4_BRANDS.has(c)) return { kind: 'VIDEO', mime: 'video/mp4' };
    }
    return null;
  }
  // Old QuickTime files without ftyp start with moov/mdat/wide/free atoms.
  if (['moov', 'mdat', 'wide', 'free', 'skip'].includes(ascii(b, 4, 8))) return { kind: 'VIDEO', mime: 'video/quicktime' };

  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return { kind: 'VIDEO', mime: b.includes(Buffer.from('webm')) ? 'video/webm' : 'video/x-matroska' };
  }
  return null;
}
