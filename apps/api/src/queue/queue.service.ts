import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { NOTIFY_JOBS, QUEUES, type PushJob, type RemindGroupsJob, type MailJob, type ProcessMediaJob, type PurgeMediaJob, type ExportJobData } from '@wcc/shared';
import { ENV, Env } from '../config/env';

/** BullMQ producers. Consumers live in apps/worker. */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues = new Map<string, Queue>();

  constructor(@Inject(ENV) private readonly env: Env) {}

  private queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: { url: this.env.REDIS_URL, maxRetriesPerRequest: null },
        prefix: this.env.QUEUE_PREFIX,
      });
      this.queues.set(name, q);
    }
    return q;
  }

  async processMedia(type: 'IMAGE' | 'VIDEO', data: ProcessMediaJob, attempt: number): Promise<void> {
    const name = type === 'VIDEO' ? QUEUES.VIDEO : QUEUES.IMAGE;
    await this.queue(name).add('process', data, {
      jobId: `media-${data.mediaId}-v${attempt}`, // idempotent (§8.3)
      attempts: 3,
      backoff: { type: 'custom' },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  async purgeMedia(data: PurgeMediaJob): Promise<void> {
    await this.queue(QUEUES.DELETE).add('purge', data, {
      jobId: `purge-${data.mediaId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 1000,
    });
  }

  async mail(data: MailJob): Promise<void> {
    await this.queue(QUEUES.MAIL).add('send', data, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: 500,
      removeOnFail: 2000,
    });
  }

  async exportZip(data: ExportJobData): Promise<void> {
    await this.queue(QUEUES.EXPORT).add('build', data, { jobId: `export-${data.exportId}`, attempts: 2, removeOnComplete: 500 });
  }

  async remindGroups(data: RemindGroupsJob): Promise<void> {
    await this.queue(QUEUES.NOTIFY).add(NOTIFY_JOBS.REMIND_GROUPS, data, { removeOnComplete: 100, removeOnFail: 100 });
  }

  async push(data: PushJob): Promise<void> {
    if (!data.userIds.length) return;
    await this.queue(QUEUES.NOTIFY).add(NOTIFY_JOBS.PUSH, data, { removeOnComplete: 200, removeOnFail: 200 });
  }

  async testPush(userId: string): Promise<void> {
    await this.queue(QUEUES.NOTIFY).add(NOTIFY_JOBS.TEST, { userId }, { removeOnComplete: 100, removeOnFail: 100 });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
