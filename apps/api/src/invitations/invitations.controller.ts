import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsEmail, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { Role } from '@wcc/db';
import { CurrentUser, Meta, Public, ReqMeta, SkipCsrfToken } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { InvitationsService } from './invitations.service';

class CreateInvitationDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @IsEnum(Role) role!: Role;
  @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) categoryIds: string[] = [];
}

class AcceptInvitationDto {
  @IsString() @MaxLength(200) token!: string;
  @IsString() @MinLength(2) @MaxLength(120) fullName!: string;
  @IsOptional() @IsString() @MaxLength(40) title?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsString() @MaxLength(200) password!: string;
}

class JoinLinkDto {
  @IsString() @MinLength(2) @MaxLength(80) label!: string;
  @IsEnum(Role) role!: Role;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) categoryIds?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(5000) maxUses?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(365) expiresInDays?: number | null;
}
class JoinDto {
  @IsString() @MinLength(2) @MaxLength(120) fullName!: string;
  @IsOptional() @IsString() @MaxLength(40) title?: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() || null : value))
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEmail({}, { message: 'Enter a valid email address, or leave it empty' })
  @MaxLength(254)
  email?: string | null;
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s-]/g, '') : value))
  @Matches(/^0\d{9}$/, { message: 'Enter your 10-digit phone number, e.g. 0241234567' })
  phone!: string;
  @IsString() @MaxLength(200) password!: string;
  @IsOptional() @IsUUID() basontaId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('4', { each: true }) bacentaIds?: string[];
}

@Controller()
export class JoinLinksController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('join-links') create(@CurrentUser() u: AuthUser, @Body() d: JoinLinkDto, @Meta() m: ReqMeta) {
    return this.invitations.createJoinLink(u, d, m);
  }
  @Get('join-links') list(@CurrentUser() u: AuthUser) {
    return this.invitations.listJoinLinks(u);
  }
  @Delete('join-links/:id') @HttpCode(204) async revoke(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() m: ReqMeta) {
    await this.invitations.revokeJoinLink(u, id, m);
  }
  @Post('invitations/:id/approve') @HttpCode(204) async approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() m: ReqMeta) {
    await this.invitations.approve(u, id, m);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('public/join/:code') info(@Param('code') code: string) {
    return this.invitations.joinInfo(String(code).slice(0, 40));
  }
  @Public()
  @SkipCsrfToken() // no session yet: Origin check only
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('public/join/:code') join(@Param('code') code: string, @Body() d: JoinDto, @Meta() m: ReqMeta) {
    return this.invitations.join(String(code).slice(0, 40), d, m);
  }

  @Get('join-links/signups') signups(@CurrentUser() u: AuthUser) {
    return this.invitations.pendingSignups(u);
  }
  @Post('join-links/signups/:id/approve') @HttpCode(204) async approveSignup(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() m: ReqMeta) {
    await this.invitations.decideSignup(u, id, true, m);
  }
  @Post('join-links/signups/:id/decline') @HttpCode(204) async declineSignup(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() m: ReqMeta) {
    await this.invitations.decideSignup(u, id, false, m);
  }
}

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInvitationDto, @Meta() meta: ReqMeta) {
    return this.invitations.create(user, dto, meta);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.invitations.listPending(user);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    await this.invitations.revoke(user, id, meta);
  }

  @Post(':id/resend')
  @HttpCode(204)
  async resend(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    await this.invitations.resend(user, id, meta);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('verify/:token')
  verify(@Param('token') token: string) {
    return this.invitations.verify(token);
  }

  @Public()
  @SkipCsrfToken()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('accept')
  @HttpCode(204)
  async accept(@Body() dto: AcceptInvitationDto, @Meta() meta: ReqMeta) {
    await this.invitations.accept(dto, meta);
  }
}
