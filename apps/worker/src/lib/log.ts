import pino from 'pino';
import { env } from '../env';

export const log = pino({ level: env.NODE_ENV === 'production' ? 'info' : 'debug', base: { app: 'wcc-worker' } });
