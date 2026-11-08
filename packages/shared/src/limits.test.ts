import { describe, expect, it } from 'vitest';
import { classifyUpload, sanitizeFilename } from './limits';
import { slugify, defaultEventTitle } from './format';
import { CATEGORY_SEED } from './categories';

describe('classifyUpload', () => {
  it('accepts allowed images, videos, raws', () => {
    expect(classifyUpload('a.JPG', 'image/jpeg')).toBe('IMAGE');
    expect(classifyUpload('b.mov', 'video/quicktime')).toBe('VIDEO');
    expect(classifyUpload('c.CR3', 'application/octet-stream')).toBe('RAW');
    expect(classifyUpload('d.heic', '')).toBe('IMAGE');
  });
  it('rejects mismatches and unknowns', () => {
    expect(classifyUpload('evil.exe', 'application/x-msdownload')).toBeNull();
    expect(classifyUpload('photo.jpg', 'video/mp4')).toBeNull();
  });
});

describe('helpers', () => {
  it('sanitizes names', () => {
    expect(sanitizeFilename('../../etc/pass\u0000wd.jpg')).toBe('passwd.jpg');
  });
  it('slugifies', () => {
    expect(slugify('Baby Christening — Ama & Kofi')).toBe('baby-christening-ama-kofi');
  });
  it('builds default titles', () => {
    expect(defaultEventTitle('Camps', '2026-11-08')).toBe('Camps — 8 Nov 2026');
  });
  it('seeds 11 unique categories including Bacenta and Regional', () => {
    expect(CATEGORY_SEED).toHaveLength(11);
    expect(new Set(CATEGORY_SEED.map((c) => c.slug)).size).toBe(11);
    expect(CATEGORY_SEED.map((c) => c.slug)).toEqual(expect.arrayContaining(['bacenta-service', 'regional-service']));
  });
});
