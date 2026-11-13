import { Throttle } from '@nestjs/throttler';
import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { AnnouncementAudience, FollowUpStatus, RsvpStatus } from '@wcc/db';
import { CurrentUser, Meta, Public, ReqMeta, SkipCsrfToken } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { InvitationsModule } from '../invitations/invitations.module';
import { InvitationsService } from '../invitations/invitations.service';
import { MembershipService } from '../membership/membership.service';
import { AudienceService } from './audience.service';
import { ChurchService } from './church.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const nullable = (_: unknown, v: unknown) => v !== null;
const bool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

class PageQuery {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}
class FollowUpQuery extends PageQuery {
  @IsOptional() @IsIn(['mine', 'all']) scope?: 'mine' | 'all';
  @IsOptional() @IsIn(['open', 'closed']) state?: 'open' | 'closed';
}
class CreateFollowUpDto {
  @IsOptional() @IsUUID() memberId?: string;
  @IsOptional() @IsUUID() guestId?: string;
  @IsString() @MinLength(2) @MaxLength(300) reason!: string;
  @IsOptional() @ValidateIf(nullable) @IsUUID() assignedToId?: string | null;
  @IsOptional() @ValidateIf(nullable) @Matches(DATE) dueOn?: string | null;
}
class UpdateFollowUpDto {
  @IsOptional() @IsEnum(FollowUpStatus) status?: FollowUpStatus;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @ValidateIf(nullable) @IsUUID() assignedToId?: string | null;
  @IsOptional() @ValidateIf(nullable) @Matches(DATE) dueOn?: string | null;
}
class RangeQuery {
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
}
class RosterDto {
  @Matches(DATE) date!: string;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(60) service?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsUUID() roleId?: string | null;
  @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) memberIds!: string[];
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(200) note?: string | null;
}
class EventQuery extends PageQuery {
  @IsOptional() @IsIn(['upcoming', 'past']) when?: 'upcoming' | 'past';
}
class UpdateEventDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) title?: string;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(3000) description?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(200) location?: string | null;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @ValidateIf(nullable) @IsDateString() endsAt?: string | null;
  @IsOptional() @IsBoolean() rsvpEnabled?: boolean;
  @IsOptional() @ValidateIf(nullable) @IsInt() @Min(1) @Max(100000) capacity?: number | null;
}
class CreateEventDto extends UpdateEventDto {
  @IsString() @MinLength(2) @MaxLength(120) declare title: string;
  @IsDateString() declare startsAt: string;
  @IsOptional() @ValidateIf(nullable) @IsUUID() groupId?: string | null;
}
class RsvpDto {
  @IsEnum(RsvpStatus) status!: RsvpStatus;
  @IsOptional() @IsInt() @Min(0) @Max(20) guests?: number;
}
class MilestoneDto {
  @IsString() @MinLength(2) @MaxLength(60) type!: string;
  @Matches(DATE) date!: string;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(300) note?: string | null;
}
class AnnQuery extends PageQuery {
  @IsOptional() @Transform(bool) @IsBoolean() manage?: boolean;
}
class UpdateAnnDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(5000) body?: string;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(500) @Matches(/^https?:\/\//) linkUrl?: string | null;
  @IsOptional() @IsBoolean() pinned?: boolean;
  @IsOptional() @ValidateIf(nullable) @IsDateString() expiresAt?: string | null;
}
class CreateAnnDto extends UpdateAnnDto {
  @IsString() @MinLength(2) @MaxLength(120) declare title: string;
  @IsString() @MinLength(1) @MaxLength(5000) declare body: string;
  @IsEnum(AnnouncementAudience) audience!: AnnouncementAudience;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) groupIds?: string[];
  @IsOptional() @ValidateIf(nullable) @IsDateString() publishAt?: string | null;
}
class VisitorCardDto {
  @IsString() @MinLength(2) @MaxLength(100) fullName!: string;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(120) location?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(120) howHeard?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(1000) prayerRequest?: string | null;
  @IsOptional() @IsBoolean() wantsToJoin?: boolean;
  @IsIn([true]) consent!: true;
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}
class ImportRowDto {
  @IsString() @MaxLength(100) fullName!: string;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(160) email?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(20) gender?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(20) dateOfBirth?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(160) location?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(60) churchRole?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(80) constituency?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(80) basonta?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(400) bacentas?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(20) joinedOn?: string | null;
}
class ImportDto {
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => ImportRowDto) rows!: ImportRowDto[];
  @IsBoolean() dryRun!: boolean;
}
class MyMemberDto {
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(160) location?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(160) email?: string | null;
  @IsOptional() @ValidateIf(nullable) @Matches(DATE) dateOfBirth?: string | null;
}
const uuid = new ParseUUIDPipe();

@Controller()
export class ChurchController {
  constructor(
    private readonly svc: ChurchService,
    private readonly invites: InvitationsService,
  ) {}

  // follow-ups
  @Get('follow-ups') followUps(@CurrentUser() u: AuthUser, @Query() q: FollowUpQuery) { return this.svc.followUps(u, q); }
  @Get('follow-ups/assignees') assignees(@CurrentUser() u: AuthUser) { return this.svc.assignees(u); }
  @Post('follow-ups') createFollowUp(@CurrentUser() u: AuthUser, @Body() d: CreateFollowUpDto, @Meta() m: ReqMeta) { return this.svc.createFollowUp(u, d, m); }
  @Patch('follow-ups/:id') updateFollowUp(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() d: UpdateFollowUpDto, @Meta() m: ReqMeta) { return this.svc.updateFollowUp(u, id, d, m); }

  // rosters
  @Get('groups/:id/roster') roster(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Query() q: RangeQuery) { return this.svc.roster(u, id, q); }
  @Post('groups/:id/roster') addRoster(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() d: RosterDto, @Meta() m: ReqMeta) { return this.svc.addRoster(u, id, d, m); }
  @Delete('groups/:id/roster/:slotId') @HttpCode(204) removeRoster(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Param('slotId', uuid) slot: string, @Meta() m: ReqMeta) { return this.svc.removeRoster(u, id, slot, m); }

  // events
  @Get('church-events') events(@CurrentUser() u: AuthUser, @Query() q: EventQuery) { return this.svc.events(u, q); }
  @Post('church-events') createEvent(@CurrentUser() u: AuthUser, @Body() d: CreateEventDto, @Meta() m: ReqMeta) { return this.svc.createEvent(u, d, m); }
  @Patch('church-events/:id') updateEvent(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() d: UpdateEventDto, @Meta() m: ReqMeta) { return this.svc.updateEvent(u, id, d, m); }
  @Delete('church-events/:id') @HttpCode(204) deleteEvent(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Meta() m: ReqMeta) { return this.svc.deleteEvent(u, id, m); }
  @Put('church-events/:id/rsvp') rsvp(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() d: RsvpDto) { return this.svc.rsvp(u, id, d); }

  // milestones
  @Get('members/:id/milestones') milestones(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.milestones(u, id); }
  @Post('members/:id/milestones') addMilestone(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() d: MilestoneDto, @Meta() m: ReqMeta) { return this.svc.addMilestone(u, id, d, m); }
  @Delete('members/:id/milestones/:mid') @HttpCode(204) removeMilestone(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Param('mid', uuid) mid: string, @Meta() m: ReqMeta) { return this.svc.removeMilestone(u, id, mid, m); }

  // member accounts
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('members/:id/invite')
  async invite(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Meta() m: ReqMeta) {
    await this.svc.memberAccess(u, id, true); // only leaders of this member's groups (or a Super Admin)
    await this.invites.inviteMember(u, id, m);
    return { ok: true };
  }
  @Get('me/church') myChurch(@CurrentUser() u: AuthUser) { return this.svc.myChurch(u); }
  @Patch('me/member') updateMyMember(@CurrentUser() u: AuthUser, @Body() d: MyMemberDto, @Meta() m: ReqMeta) { return this.svc.updateMyMember(u, d, m); }

  // import
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('members/import') import(@CurrentUser() u: AuthUser, @Body() d: ImportDto, @Meta() m: ReqMeta) { return this.svc.importMembers(u, d.rows, d.dryRun, m); }

  // announcements
  @Get('announcements') announcements(@CurrentUser() u: AuthUser, @Query() q: AnnQuery) { return this.svc.announcements(u, q); }
  @Post('announcements') createAnn(@CurrentUser() u: AuthUser, @Body() d: CreateAnnDto, @Meta() m: ReqMeta) { return this.svc.createAnnouncement(u, d, m); }
  @Patch('announcements/:id') updateAnn(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() d: UpdateAnnDto, @Meta() m: ReqMeta) { return this.svc.updateAnnouncement(u, id, d, m); }
  @Delete('announcements/:id') @HttpCode(204) deleteAnn(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Meta() m: ReqMeta) { return this.svc.deleteAnnouncement(u, id, m); }
  @Post('announcements/:id/read') @HttpCode(204) read(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.svc.markRead(u, id); }

  // visitor cards
  @Get('visitor-cards') cards(@CurrentUser() u: AuthUser, @Query() q: PageQuery) { return this.svc.visitorCards(u, q); }
  @Get('visitor-cards/qr') qr(@CurrentUser() u: AuthUser) { return this.svc.visitorCardQr(u); }

  @Public()
  @SkipCsrfToken() // anonymous visitors: Origin check only
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('public/visitor-card')
  @HttpCode(201)
  visitorCard(@Body() d: VisitorCardDto) { return this.svc.visitorCard(d); }
}

@Module({ imports: [InvitationsModule], controllers: [ChurchController], providers: [ChurchService, AudienceService, MembershipService], exports: [AudienceService] })
export class ChurchModule {}
