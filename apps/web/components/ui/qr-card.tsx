'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { Copy, Download, Printer, Share2 } from 'lucide-react';
import { Button } from './button';

const BRAND = '#c8102e';
const W = 1200;
const H = 1740;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Word-wraps centred text; returns the y after the last line. */
function wrap(ctx: CanvasRenderingContext2D, text: string, y: number, maxW: number, lineH: number, maxLines = 3): number {
  const lines: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) lines.push(line), (line = w);
    else line = test;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown[maxLines - 1] = `${shown[maxLines - 1]}…`;
  for (const l of shown) ctx.fillText(l, W / 2, y), (y += lineH);
  return y;
}

/** Draws the printable card: church header, big QR with the logo in the middle, instructions. */
async function drawCard(canvas: HTMLCanvasElement, o: { url: string; title: string; subtitle?: string; steps?: string[] }) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Header band with logo and church name
  ctx.fillStyle = BRAND;
  ctx.fillRect(0, 0, W, 230);
  const logo = await loadImage('/logo.png').catch(() => null);
  if (logo) {
    ctx.save();
    roundRect(ctx, 70, 45, 140, 140, 28);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.clip();
    ctx.drawImage(logo, 80, 55, 120, 120);
    ctx.restore();
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.font = `700 60px ${font}`;
  ctx.fillText('Westend City Church', 250, 120);
  ctx.font = `400 34px ${font}`;
  ctx.globalAlpha = 0.9;
  ctx.fillText('The Life Cathedral', 252, 170);
  ctx.globalAlpha = 1;

  // Title + subtitle
  ctx.textAlign = 'center';
  ctx.fillStyle = '#111827';
  ctx.font = `800 76px ${font}`;
  let y = wrap(ctx, o.title, 345, W - 160, 88, 2);
  if (o.subtitle) {
    ctx.fillStyle = '#4b5563';
    ctx.font = `400 38px ${font}`;
    y = wrap(ctx, o.subtitle, y + 6, W - 200, 50, 3);
  }

  // QR code (high error correction so the logo in the middle doesn't stop it scanning)
  const size = 760;
  const qx = (W - size) / 2;
  const qy = Math.max(y + 30, 520);
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, o.url, { errorCorrectionLevel: 'H', margin: 1, width: size, color: { dark: '#111827', light: '#ffffff' } });
  ctx.save();
  roundRect(ctx, qx - 30, qy - 30, size + 60, size + 60, 40);
  ctx.strokeStyle = BRAND;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.restore();
  ctx.drawImage(qr, qx, qy, size, size);
  if (logo) {
    const l = 170;
    const lx = W / 2 - l / 2;
    const ly = qy + size / 2 - l / 2;
    ctx.save();
    roundRect(ctx, lx - 14, ly - 14, l + 28, l + 28, 30);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    roundRect(ctx, lx, ly, l, l, 22);
    ctx.clip();
    ctx.drawImage(logo, lx, ly, l, l);
    ctx.restore();
  }

  // Steps
  let sy = qy + size + 105;
  ctx.font = `500 36px ${font}`;
  ctx.fillStyle = '#111827';
  (o.steps ?? ['Open your phone camera', 'Point it at the code', 'Tap the link that appears']).forEach((s, i) => {
    ctx.fillText(`${i + 1}. ${s}`, W / 2, sy);
    sy += 52;
  });
  // URL
  ctx.fillStyle = '#6b7280';
  ctx.font = `400 28px ${font}`;
  ctx.fillText(o.url.replace(/^https?:\/\//, ''), W / 2, H - 50);
}

/**
 * A branded QR code card: shown on screen, downloadable as a PNG, printable and shareable.
 * The QR points at `url`, which is built from the address the app is running on, so codes
 * made in the live app point at the live app.
 */
export function QrCard({ url, title, subtitle, steps, filename, className }: { url: string; title: string; subtitle?: string; steps?: string[]; filename: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (ref.current) void drawCard(ref.current, { url, title, subtitle, steps }).then(() => setReady(true));
  }, [url, title, subtitle, steps]);

  const blob = () => new Promise<Blob>((res, rej) => ref.current!.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t make the image'))), 'image/png'));
  const download = () => {
    const a = document.createElement('a');
    a.href = ref.current!.toDataURL('image/png');
    a.download = `${filename}.png`;
    a.click();
  };
  const print = () => {
    const w = window.open('', '_blank', 'width=700,height=900');
    if (!w) return toast.error('Allow pop-ups to print');
    w.document.write(`<title>${title.replace(/</g, '')}</title><style>@page{margin:10mm}body{margin:0;display:flex;justify-content:center}img{max-width:100%;max-height:97vh}</style><img src="${ref.current!.toDataURL('image/png')}">`);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };
  const share = async () => {
    try {
      const file = new File([await blob()], `${filename}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title, text: `${title}: ${url}` });
      else if (navigator.share) await navigator.share({ title, url });
      else download();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error('Couldn’t share');
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error('Couldn’t copy');
    }
  };

  return (
    <div className={className}>
      <canvas ref={ref} className="mx-auto block h-auto w-full max-w-xs rounded-xl border border-border shadow-sm" aria-label={`QR code: ${title}`} data-qr-card />
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Button size="sm" disabled={!ready} onClick={download}>
          <Download className="h-4 w-4" /> Download
        </Button>
        <Button size="sm" variant="outline" disabled={!ready} onClick={print}>
          <Printer className="h-4 w-4" /> Print
        </Button>
        <Button size="sm" variant="outline" disabled={!ready} onClick={() => void share()}>
          <Share2 className="h-4 w-4" /> Share
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void copy()}>
          <Copy className="h-4 w-4" /> Copy link
        </Button>
      </div>
    </div>
  );
}

/** The address the app is running on (the live site in production). */
export function useOrigin(): string | null {
  const [o, setO] = useState<string | null>(null);
  useEffect(() => setO(window.location.origin), []);
  return o;
}
