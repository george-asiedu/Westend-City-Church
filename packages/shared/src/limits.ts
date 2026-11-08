export const MB = 1024 * 1024;
export const GB = 1024 * MB;

export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'image/tiff',
] as const;
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm'] as const;

/** RAW camera files (§19): stored as originals; preview from the embedded JPEG. */
export const RAW_EXTENSIONS = ['.cr2', '.cr3', '.nef', '.arw', '.dng'] as const;
export const RAW_MIME_FALLBACK = 'image/x-raw';

export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.tif', '.tiff'] as const;
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.webm'] as const;

export const DEFAULT_LIMITS = {
  maxImageBytes: 60 * MB,
  maxRawBytes: 120 * MB,
  maxVideoBytes: 20 * GB,
  maxFilesPerInit: 1000,
  multipartThresholdBytes: 100 * MB,
  partSizeBytes: 16 * MB,
  maxBulkIds: 500,
  maxPageSize: 200,
  defaultPageSize: 60,
  trashRetentionDays: 30,
} as const;

export const TIMEZONE = 'Africa/Accra';

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i < 0 ? '' : filename.slice(i).toLowerCase();
}

export type FileKind = 'IMAGE' | 'RAW' | 'VIDEO';

/** Classifies a file by extension + claimed MIME. Returns null when not allowed. */
export function classifyUpload(filename: string, mimeType: string): FileKind | null {
  const ext = extensionOf(filename);
  const mime = mimeType.toLowerCase();
  if ((RAW_EXTENSIONS as readonly string[]).includes(ext)) return 'RAW';
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext) && (IMAGE_MIME_TYPES as readonly string[]).includes(mime))
    return 'IMAGE';
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext) && (VIDEO_MIME_TYPES as readonly string[]).includes(mime))
    return 'VIDEO';
  // Phones sometimes report HEIC as an empty or generic type.
  if (['.heic', '.heif'].includes(ext) && (mime === '' || mime === 'application/octet-stream')) return 'IMAGE';
  return null;
}

export function maxBytesFor(kind: FileKind, limits = DEFAULT_LIMITS): number {
  return kind === 'VIDEO' ? limits.maxVideoBytes : kind === 'RAW' ? limits.maxRawBytes : limits.maxImageBytes;
}

/** Strip path components and control characters; cap at 255. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (clean || 'file').slice(0, 255);
}
