import { audience } from '@wcc/db';
import { prisma } from './prisma';

/** The shared audience rules (same as the API), bound to the worker's Prisma client. */
export const usersForMembers = (memberIds: string[]) => audience.usersForMembers(prisma, memberIds);
export const announcementAudience = (a: 'CHURCH' | 'GROUPS' | 'LEADERS', groupIds: string[]) => audience.announcementAudience(prisma, a, groupIds);
