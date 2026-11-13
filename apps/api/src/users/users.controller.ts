import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Role, UserStatus } from '@wcc/db';
import { AllowPending2fa, CurrentUser, Meta, ReqMeta } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { UsersService } from './users.service';

class ListUsersQuery {
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

class UpdateUserDto {
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) fullName?: string;
  @IsOptional() @IsString() @MaxLength(40) title?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
}

class UpdateMeDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) fullName?: string;
  @IsOptional() @IsString() @MaxLength(40) title?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
}

class GrantDto {
  @IsUUID() categoryId!: string;
  @IsBoolean() canView!: boolean;
  @IsBoolean() canUpload!: boolean;
  @IsBoolean() canManage!: boolean;
}
class GrantsDto {
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => GrantDto) grants!: GrantDto[];
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListUsersQuery) {
    return this.users.list(user, q);
  }

  @AllowPending2fa()
  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto, @Meta() meta: ReqMeta) {
    return this.users.updateMe(user, dto, meta);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @Meta() meta: ReqMeta) {
    return this.users.update(user, id, dto, meta);
  }

  /** Body is `{ grants: [...] }` (an object, so the whitelist validator can check it). Replaces all. */
  @Put(':id/category-access')
  setAccess(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GrantsDto, @Meta() meta: ReqMeta) {
    return this.users.setAccess(user, id, dto.grants, meta);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    return this.users.remove(user, id, meta);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    return this.users.resetPassword(user, id, meta);
  }

  @Post(':id/revoke-sessions')
  @HttpCode(200)
  revokeSessions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    return this.users.revokeSessions(user, id, meta);
  }
}
