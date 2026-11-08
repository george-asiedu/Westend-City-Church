import { describe, expect, it } from 'vitest';
import { sniff } from './sniff';

const pad = (b: number[] | Buffer) => Buffer.concat([Buffer.from(b), Buffer.alloc(32)]);
const ftyp = (brand: string) => pad(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp' + brand), Buffer.alloc(12)]));

describe('sniff', () => {
  it('detects images', () => {
    expect(sniff(pad([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(sniff(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime).toBe('image/png');
    expect(sniff(ftyp('heic'))?.mime).toBe('image/heic');
  });
  it('detects videos', () => {
    expect(sniff(ftyp('qt  '))?.mime).toBe('video/quicktime');
    expect(sniff(ftyp('isom'))?.mime).toBe('video/mp4');
    expect(sniff(pad([0x1a, 0x45, 0xdf, 0xa3]))?.kind).toBe('VIDEO');
  });
  it('detects raws', () => {
    expect(sniff(ftyp('crx '))?.kind).toBe('RAW');
    expect(sniff(pad([0x49, 0x49, 0x2a, 0x00, 0x10, 0, 0, 0, 0x43, 0x52]))?.kind).toBe('RAW');
  });
  it('rejects an .exe renamed .jpg', () => {
    expect(sniff(pad([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
  });
});
