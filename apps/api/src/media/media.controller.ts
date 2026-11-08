import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { CurrentUser, Meta, ReqMeta } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { MediaService, type BulkAction } from './media.service';

class ListMediaDto {
  @IsOptional() @IsEnum(['IMAGE', 'VIDEO']) type?: 'IMAGE' | 'VIDEO';
  @IsOptional() @IsEnum(['PENDING_UPLOAD', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED']) status?: 'READY';
  @IsOptional() @IsString() @MaxLength(40) tag?: string;
  @IsOptional() @IsUUID() uploadedBy?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() featured?: boolean;
  @IsOptional() @IsEnum(['takenAt', 'createdAt', 'sortOrder']) sort?: 'takenAt';
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() limit?: number;
}

class UpdateMediaDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) caption?: string | null;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsBoolean() isPublicHighlight?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
}

class BulkDto {
  @IsEnum(['delete', 'move', 'tag', 'untag', 'feature', 'unfeature']) action!: BulkAction;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('4', { each: true }) mediaIds!: string[];
  @IsOptional() @IsUUID() targetEventId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
}

@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get('events/:id/media')
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: ListMediaDto) {
    return this.media.listForEvent(user, id, q);
  }

  @Post('media/bulk')
  @HttpCode(200)
  bulk(@CurrentUser() user: AuthUser, @Body() dto: BulkDto, @Meta() meta: ReqMeta) {
    return this.media.bulk(user, dto, meta);
  }

  @Get('media/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.get(user, id);
  }

  @Patch('media/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMediaDto, @Meta() meta: ReqMeta) {
    return this.media.update(user, id, dto, meta);
  }

  @Delete('media/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    await this.media.remove(user, id, meta);
  }

  @Post('media/:id/restore')
  @HttpCode(200)
  restore(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    return this.media.restore(user, id, meta);
  }

  @Post('media/:id/reprocess')
  @HttpCode(200)
  reprocess(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    return this.media.reprocess(user, id, meta);
  }

  /** 302 to a 5-minute presigned S3 URL with the original filename (§8.4). */
  @Get('media/:id/download')
  async download(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, await this.media.downloadUrl(user, id, meta));
  }
}
