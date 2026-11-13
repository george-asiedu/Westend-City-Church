import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AttendanceKind, GroupType, GuestIntent } from '@wcc/db';
import { CurrentUser, Meta, ReqMeta } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { MembershipService } from './membership.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const nullable = (_: unknown, v: unknown) => v !== null;

class GroupDto {
  @IsEnum(GroupType) type!: GroupType;
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(40) meetingDay?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(160) meetingPlace?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsUUID() pastorId?: string | null;
  @IsOptional() @IsUUID() parentId?: string;
}
class RoleDto {
  @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @IsOptional() @ValidateIf(nullable) @IsUUID() leadId?: string | null;
}
class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @ValidateIf(nullable) @IsUUID() leadId?: string | null;
}
class AddMemberDto {
  @IsUUID() memberId!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsUUID('4', { each: true }) roleIds?: string[];
}
class RoleIdsDto {
  @IsArray() @ArrayMaxSize(30) @IsUUID('4', { each: true }) roleIds!: string[];
}
class BacentaInputDto {
  @IsUUID() groupId!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsUUID('4', { each: true }) roleIds?: string[];
}
class UpdateGroupDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(40) meetingDay?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(160) meetingPlace?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsUUID() pastorId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @ValidateIf(nullable) @IsUUID() leadMemberId?: string | null;
  @IsOptional() @IsBoolean() recordsServices?: boolean;
}
class GroupQuery {
  @IsOptional() @IsEnum(GroupType) type?: GroupType;
}

class MemberDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) fullName?: string;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(30) @Matches(/^[+\d\s()-]*$/, { message: 'Phone can only contain digits, spaces, +, - and brackets' }) phone?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsEmail() @MaxLength(254) email?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsIn(['Male', 'Female', '']) gender?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @Matches(DATE) dateOfBirth?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(160) location?: string | null;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) churchRole?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsUUID() constituencyId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsUUID() basontaId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => BacentaInputDto) bacentas?: BacentaInputDto[];
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @Matches(DATE) joinedOn?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(1000) notes?: string | null;
  @IsOptional() @IsUUID() fromGuestId?: string;
}
class MoveDto {
  @IsUUID() fromGroupId!: string;
  @IsUUID() toGroupId!: string;
}
class ShepherdDto {
  @IsUUID() userId!: string;
}
class MemberQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @ValidateIf((_, v) => v !== 'none') @IsUUID() constituencyId?: string;
  @IsOptional() @ValidateIf((_, v) => v !== 'none') @IsUUID() basontaId?: string;
  @IsOptional() @IsUUID() bacentaId?: string;
  @IsOptional() @ValidateIf((_, v) => v !== 'none') @IsUUID() teamRoleId?: string;
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() leaders?: boolean;
  @IsOptional() @IsString() @MaxLength(60) churchRole?: string;
  @IsOptional() @IsIn(['active', 'inactive', 'all']) status?: 'active' | 'inactive' | 'all';
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

class SessionDto {
  @IsOptional() @ValidateIf(nullable) @IsUUID() groupId?: string | null;
  @IsString() @MinLength(2) @MaxLength(40) serviceType!: string;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(120) title?: string | null;
  @Matches(DATE) date!: string;
}
class SheetDto {
  @IsArray() @ArrayMaxSize(5000) @IsUUID('4', { each: true }) presentIds!: string[];
  @IsArray() @ArrayMaxSize(5000) @IsUUID('4', { each: true }) rosterIds!: string[];
  @IsOptional() @IsInt() @Min(0) @Max(100000) visitorCount?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) firstTimerCount?: number;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(1000) notes?: string | null;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(40) serviceType?: string;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(120) title?: string | null;
  @IsOptional() @Matches(DATE) date?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1000000) headcount?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000000) newConvertCount?: number;
}
class GuestInputDto {
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(120) fullName?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(30) @Matches(/^[+\d\s()-]*$/) phone?: string | null;
  @IsEnum(GuestIntent) intent!: GuestIntent;
}
class BroughtDto {
  @IsInt() @Min(0) @Max(200) broughtCount!: number;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => GuestInputDto) guests!: GuestInputDto[];
}
class PageQuery {
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}
class LeadersQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['PASTOR', 'SHEPHERD']) role?: 'PASTOR' | 'SHEPHERD';
  @IsOptional() @IsIn(['new', 'unassigned']) show?: 'new' | 'unassigned';
}
class SessionQuery extends PageQuery {
  @IsOptional() @IsEnum(AttendanceKind) kind?: AttendanceKind;
  @IsOptional() @IsUUID() groupId?: string;
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
  /** Church services plus the groups this user looks after. */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() mine?: boolean;
}
class DayQuery {
  @Matches(DATE) date!: string;
}
class RangeQuery {
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
}

@Controller('groups')
export class GroupsController {
  constructor(private readonly svc: MembershipService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: GroupQuery) {
    return this.svc.listGroups(user, q.type);
  }

  /** Users who can be chosen as a group's pastor. */
  @Get('pastors')
  pastors(@CurrentUser() user: AuthUser) {
    return this.svc.pastors(user);
  }

  @Get('shepherd-candidates')
  shepherdCandidates(@CurrentUser() user: AuthUser) {
    return this.svc.shepherdCandidates(user);
  }

  /** Every pastor and shepherd (Super Admin). */
  @Get('leaders')
  leaders(@CurrentUser() user: AuthUser, @Query() q: LeadersQuery) {
    return this.svc.leaders(user, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getGroup(user, id);
  }

  @Get(':id/stats')
  stats(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: RangeQuery) {
    return this.svc.groupStats(user, id, q);
  }

  @Post(':id/shepherds')
  addShepherd(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShepherdDto, @Meta() meta: ReqMeta) {
    return this.svc.addShepherd(user, id, dto.userId, meta);
  }

  @Delete(':id/shepherds/:userId')
  removeShepherd(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Meta() meta: ReqMeta) {
    return this.svc.removeShepherd(user, id, userId, meta);
  }

  @Post(':id/roles')
  createRole(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoleDto, @Meta() meta: ReqMeta) {
    return this.svc.createRole(user, id, dto, meta);
  }

  @Patch(':id/roles/:roleId')
  updateRole(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('roleId', ParseUUIDPipe) roleId: string, @Body() dto: UpdateRoleDto, @Meta() meta: ReqMeta) {
    return this.svc.updateRole(user, id, roleId, dto, meta);
  }

  @Delete(':id/roles/:roleId')
  deleteRole(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('roleId', ParseUUIDPipe) roleId: string, @Meta() meta: ReqMeta) {
    return this.svc.deleteRole(user, id, roleId, meta);
  }

  /** Add an existing member to this group. */
  @Post(':id/members')
  addMember(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMemberDto, @Meta() meta: ReqMeta) {
    return this.svc.addToGroup(user, id, dto.memberId, dto.roleIds, meta);
  }

  @Put(':id/members/:memberId/roles')
  setRoles(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('memberId', ParseUUIDPipe) memberId: string, @Body() dto: RoleIdsDto, @Meta() meta: ReqMeta) {
    return this.svc.setMemberRoles(user, id, memberId, dto.roleIds, meta);
  }

  @Delete(':id/members/:memberId')
  @HttpCode(204)
  async removeMember(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('memberId', ParseUUIDPipe) memberId: string, @Meta() meta: ReqMeta) {
    await this.svc.removeFromGroup(user, id, memberId, meta);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: GroupDto, @Meta() meta: ReqMeta) {
    return this.svc.createGroup(user, dto, meta);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGroupDto, @Meta() meta: ReqMeta) {
    return this.svc.updateGroup(user, id, dto, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    await this.svc.deleteGroup(user, id, meta);
  }
}

@Controller('members')
export class MembersController {
  constructor(private readonly svc: MembershipService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: MemberQuery) {
    return this.svc.listMembers(user, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getMember(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: MemberDto, @Meta() meta: ReqMeta) {
    return this.svc.createMember(user, dto, meta);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MemberDto, @Meta() meta: ReqMeta) {
    return this.svc.updateMember(user, id, dto, meta);
  }

  @Post(':id/move')
  @HttpCode(200)
  move(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveDto, @Meta() meta: ReqMeta) {
    return this.svc.moveMember(user, id, dto.fromGroupId, dto.toGroupId, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    await this.svc.deleteMember(user, id, meta);
  }
}

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly svc: MembershipService) {}

  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser, @Query() q: SessionQuery) {
    return this.svc.listSessions(user, q);
  }

  /** Opens (or creates) the session for a service/meeting on a date. */
  @Post('sessions')
  @HttpCode(200)
  createSession(@CurrentUser() user: AuthUser, @Body() dto: SessionDto, @Meta() meta: ReqMeta) {
    return this.svc.createSession(user, dto, meta);
  }

  @Get('sessions/:id')
  sheet(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getSheet(user, id);
  }

  @Put('sessions/:id')
  save(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SheetDto, @Meta() meta: ReqMeta) {
    return this.svc.saveSheet(user, id, dto, meta);
  }

  @Put('sessions/:id/brought/:memberId')
  brought(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: BroughtDto,
    @Meta() meta: ReqMeta,
  ) {
    return this.svc.saveBrought(user, id, memberId, dto, meta);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async removeSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    await this.svc.deleteSession(user, id, meta);
  }

  /** People brought who want to join and aren't members yet. */
  @Get('guests/pending')
  pendingGuests(@CurrentUser() user: AuthUser, @Query() q: PageQuery) {
    return this.svc.pendingGuests(user, q);
  }

  /** One day by constituency (sum of basontas). */
  @Get('day')
  day(@CurrentUser() user: AuthUser, @Query() q: DayQuery) {
    return this.svc.day(user, q.date);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    return this.svc.summary(user, q);
  }
}

@Module({ controllers: [GroupsController, MembersController, AttendanceController], providers: [MembershipService] })
export class MembershipModule {}
