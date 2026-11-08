import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { CurrentUser, Meta, ReqMeta } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { EventsService } from './events.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

class ListEventsDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1900) @Max(3000) year?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional() @IsString() @MaxLength(60) programType?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(['DRAFT', 'PUBLISHED']) status?: 'DRAFT' | 'PUBLISHED';
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() limit?: number;
}

class CreateEventDto {
  @IsUUID() categoryId!: string;
  @Matches(DATE) eventDate!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @Matches(DATE) endDate?: string | null;
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(60) programType?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(160) location?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5000) description?: string | null;
  @IsOptional() @IsEnum(['DRAFT', 'PUBLISHED']) status?: 'DRAFT' | 'PUBLISHED';
}

class UpdateEventDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @Matches(DATE) eventDate?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @Matches(DATE) endDate?: string | null;
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(60) programType?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(160) location?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5000) description?: string | null;
  @IsOptional() @IsEnum(['DRAFT', 'PUBLISHED']) status?: 'DRAFT' | 'PUBLISHED';
}

class LookupDto {
  @IsUUID() categoryId!: string;
  @Matches(DATE) date!: string;
}

class CoverDto {
  @IsUUID() mediaId!: string;
}

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListEventsDto) {
    return this.events.list(user, q);
  }

  @Get('lookup')
  lookup(@CurrentUser() user: AuthUser, @Query() q: LookupDto) {
    return this.events.lookup(user, q.categoryId, q.date);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateEventDto, @Meta() meta: ReqMeta) {
    return this.events.create(user, dto, meta);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.get(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEventDto, @Meta() meta: ReqMeta) {
    return this.events.update(user, id, dto, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    await this.events.remove(user, id, meta);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    return this.events.restore(user, id, meta);
  }

  @Post(':id/cover')
  @HttpCode(200)
  cover(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CoverDto, @Meta() meta: ReqMeta) {
    return this.events.setCover(user, id, dto.mediaId, meta);
  }
}
