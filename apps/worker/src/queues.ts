import { Queue } from 'bullmq';
import { QUEUES, type PurgeMediaJob } from '@wcc/shared';
import { env } from './env';

export const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null } as const;
const opts = { connection, prefix: env.QUEUE_PREFIX };

export const queues = {
  image: new Queue(QUEUES.IMAGE, opts),
  video: new Queue(QUEUES.VIDEO, opts),
  delete: new Queue(QUEUES.DELETE, opts),
  maintenance: new Queue(QUEUES.MAINTENANCE, opts),
  mail: new Queue(QUEUES.MAIL, opts),
  export: new Queue(QUEUES.EXPORT, opts),
  notify: new Queue(QUEUES.NOTIFY, opts),
};

export const enqueue = {
  purge: (data: PurgeMediaJob) =>
    queues.delete.add('purge', data, { jobId: `purge-${data.mediaId}`, attempts: 5, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000 }),
  process: (type: 'IMAGE' | 'VIDEO', mediaId: string, attempt: number) =>
    (type === 'VIDEO' ? queues.video : queues.image).add(
      'process',
      { mediaId },
      { jobId: `media-${mediaId}-v${attempt}`, attempts: 3, backoff: { type: 'custom' }, removeOnComplete: 1000, removeOnFail: 5000 },
    ),
};
