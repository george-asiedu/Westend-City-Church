import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { CurrentUser, Meta, ReqMeta } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { UploadsService } from './uploads.service';

class InitFileDto {
  // Uppy's file id (echoed back, never stored): it includes the file name, so allow as much as filenames.
  @IsString() @MaxLength(1000) clientId!: string;
  @IsString() @MaxLength(1000) filename!: string;
  @IsInt() @Min(1) size!: number;
  @IsString() @MaxLength(100) mimeType!: string;
}
class InitDto {
  @IsUUID() eventId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => InitFileDto) files!: InitFileDto[];
}
class PartsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsInt({ each: true }) partNumbers!: number[];
}
class PartDto {
  @IsInt() @Min(1) partNumber!: number;
  @IsString() @MaxLength(200) etag!: string;
}
class CompleteDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10000) @ValidateNested({ each: true }) @Type(() => PartDto) parts!: PartDto[];
}

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('init')
  @HttpCode(200)
  init(@CurrentUser() user: AuthUser, @Body() dto: InitDto, @Meta() meta: ReqMeta) {
    return this.uploads.init(user, dto.eventId, dto.files, meta);
  }

  // Part signing happens many times per large file; the global limit is too tight for it.
  @Throttle({ default: { limit: 1200, ttl: 60_000 } })
  @Post(':mediaId/parts')
  @HttpCode(200)
  sign(@CurrentUser() user: AuthUser, @Param('mediaId', ParseUUIDPipe) id: string, @Body() dto: PartsDto) {
    return this.uploads.signParts(user, id, dto.partNumbers);
  }

  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post(':mediaId/put-url')
  @HttpCode(200)
  putUrl(@CurrentUser() user: AuthUser, @Param('mediaId', ParseUUIDPipe) id: string) {
    return this.uploads.putUrl(user, id);
  }

  @Get(':mediaId/parts')
  parts(@CurrentUser() user: AuthUser, @Param('mediaId', ParseUUIDPipe) id: string) {
    return this.uploads.listParts(user, id);
  }

  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post(':mediaId/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser, @Param('mediaId', ParseUUIDPipe) id: string, @Body() dto: CompleteDto) {
    return this.uploads.complete(user, id, dto.parts);
  }

  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post(':mediaId/finalize')
  @HttpCode(200)
  finalize(@CurrentUser() user: AuthUser, @Param('mediaId', ParseUUIDPipe) id: string) {
    return this.uploads.finalize(user, id);
  }

  @Delete(':mediaId')
  @HttpCode(204)
  async abort(@CurrentUser() user: AuthUser, @Param('mediaId', ParseUUIDPipe) id: string) {
    await this.uploads.abort(user, id);
  }
}
