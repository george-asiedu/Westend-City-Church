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
} from 'class-validator';
import { AttendanceKind, GroupType } from '@wcc/db';
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
}
class UpdateGroupDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(40) meetingDay?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(160) meetingPlace?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsUUID() pastorId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
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
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsUUID('4', { each: true }) basontaIds?: string[];
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @Matches(DATE) joinedOn?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(1000) notes?: string | null;
}
class MemberQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @ValidateIf((_, v) => v !== 'none') @IsUUID() constituencyId?: string;
  @IsOptional() @IsUUID() basontaId?: string;
  @IsOptional() @IsIn(['active', 'inactive', 'all']) status?: 'active' | 'inactive' | 'all';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

class SheetQuery {
  @IsEnum(AttendanceKind) kind!: AttendanceKind;
  @IsOptional() @IsUUID() groupId?: string;
  @Matches(DATE) date!: string;
}
class SheetDto {
  @IsEnum(AttendanceKind) kind!: AttendanceKind;
  @IsOptional() @ValidateIf(nullable) @IsUUID() groupId?: string | null;
  @Matches(DATE) date!: string;
  @IsArray() @ArrayMaxSize(5000) @IsUUID('4', { each: true }) presentIds!: string[];
  @IsArray() @ArrayMaxSize(5000) @IsUUID('4', { each: true }) rosterIds!: string[];
  @IsOptional() @IsInt() @Min(0) @Max(100000) visitorCount?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) firstTimerCount?: number;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(1000) notes?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @MaxLength(120) title?: string | null;
}
class SessionQuery {
  @IsOptional() @IsEnum(AttendanceKind) kind?: AttendanceKind;
  @IsOptional() @IsUUID() groupId?: string;
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
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

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getGroup(user, id);
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

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    await this.svc.deleteMember(user, id, meta);
  }
}

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly svc: MembershipService) {}

  /** The roster for one service/meeting on one date, with who was present. */
  @Get('sheet')
  sheet(@CurrentUser() user: AuthUser, @Query() q: SheetQuery) {
    return this.svc.getSheet(user, q);
  }

  @Put('sheet')
  save(@CurrentUser() user: AuthUser, @Body() dto: SheetDto, @Meta() meta: ReqMeta) {
    return this.svc.saveSheet(user, dto, meta);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser, @Query() q: SessionQuery) {
    return this.svc.listSessions(user, q);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async removeSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    await this.svc.deleteSession(user, id, meta);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    return this.svc.summary(user, q);
  }
}

@Module({ controllers: [GroupsController, MembersController, AttendanceController], providers: [MembershipService] })
export class MembershipModule {}
