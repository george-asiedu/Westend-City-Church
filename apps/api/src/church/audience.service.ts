import { Injectable } from '@nestjs/common';
import { audience } from '@wcc/db';
import { PrismaService } from '../prisma/prisma.service';

export { normalizePhone, tenDigitPhone } from '@wcc/shared';

/**
 * Who should hear about something in the church: group leaders, and app users who are
 * members of the group. A thin injectable wrapper over the shared implementation in
 * @wcc/db (the worker uses the same functions).
 */
@Injectable()
export class AudienceService {
  constructor(private readonly prisma: PrismaService) {}

  usersForMembers = (memberIds: string[]) => audience.usersForMembers(this.prisma, memberIds);
  leadersOf = (groupIds: string[]) => audience.leadersOf(this.prisma, groupIds);
  usersInGroups = (groupIds: string[]) => audience.usersInGroups(this.prisma, groupIds);
  allLeaders = () => audience.allLeaders(this.prisma);
  everyone = () => audience.everyone(this.prisma);
  announcementAudience = (a: 'CHURCH' | 'GROUPS' | 'LEADERS', groupIds: string[]) =>
    audience.announcementAudience(this.prisma, a, groupIds);
  groupsOfUser = (userId: string) => audience.groupsOfUser(this.prisma, userId);
}
