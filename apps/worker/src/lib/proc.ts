import { spawn } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import { env } from '../env';

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Runs a command at lower CPU priority (`nice -n 10`, §8.3) with a timeout. */
export function run(cmd: string, args: string[], opts: { timeoutMs?: number; nice?: boolean } = {}): Promise<RunResult> {
  const [bin, argv] = opts.nice === false ? [cmd, args] : ['nice', ['-n', '10', cmd, ...args]];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs) : null;
    child.on('error', reject);
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

export async function freeBytes(dir = env.WORKER_TMP_DIR): Promise<number> {
  const s = await statfs(dir);
  return s.bavail * s.bsize;
}

/** True when `needed` bytes fit while keeping the reserve free (§8.3 step 6). */
export async function hasRoomFor(needed: number): Promise<boolean> {
  return (await freeBytes()) - env.WORKER_TMP_RESERVE_GB * 1024 ** 3 > needed;
}

export interface Probe {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  formatName: string;
  creationTime: Date | null;
  rotation: number;
}

export async function ffprobe(input: string): Promise<Probe> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input], { timeoutMs: 120_000, nice: false });
  const j = JSON.parse(stdout) as {
    format?: { duration?: string; format_name?: string; tags?: Record<string, string> };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; tags?: Record<string, string>; side_data_list?: Array<{ rotation?: number }> }>;
  };
  const v = j.streams?.find((s) => s.codec_type === 'video');
  const a = j.streams?.find((s) => s.codec_type === 'audio');
  const ct = j.format?.tags?.creation_time ?? v?.tags?.creation_time;
  const rotation = Math.abs(Number(v?.tags?.rotate ?? v?.side_data_list?.find((x) => x.rotation !== undefined)?.rotation ?? 0)) % 180;
  const created = ct ? new Date(ct) : null;
  return {
    durationSec: j.format?.duration ? Number(j.format.duration) : null,
    width: (rotation === 90 ? v?.height : v?.width) ?? null,
    height: (rotation === 90 ? v?.width : v?.height) ?? null,
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
    formatName: j.format?.format_name ?? '',
    creationTime: created && !Number.isNaN(created.getTime()) && created.getFullYear() > 1971 ? created : null,
    rotation,
  };
}

/** Input options that let ffmpeg survive dropped HTTPS connections to S3. */
export const HTTP_INPUT = ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '30'];
