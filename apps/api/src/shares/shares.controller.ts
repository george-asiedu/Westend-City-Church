import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ENV, Env } from '../config/env';
import { CurrentUser, Meta, Public, ReqMeta, SkipCsrfToken } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { cookieBase } from '../auth/cookies';
import { SharesService } from './shares.service';

class CreateShareDto {
  @IsOptional() @IsUUID() eventId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) mediaIds?: string[];
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsInt() @Min(1) @Max(24 * 90) expiresInHours!: number;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(200) password?: string;
  @IsBoolean() allowDownload!: boolean;
}
class ListSharesDto {
  @IsOptional() @IsUUID() eventId?: string;
}
class UnlockDto {
  @IsString() @MaxLength(200) password!: string;
}
class PageDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() limit?: number;
}

@Controller('shares')
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateShareDto, @Meta() meta: ReqMeta) {
    return this.shares.create(user, { ...dto, password: dto.password || undefined }, meta);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListSharesDto) {
    return this.shares.list(user, q.eventId);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    await this.shares.revoke(user, id, meta);
  }
}

/** Unauthenticated endpoints used by /s/[token] in the web app. */
@Public()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('public/shares')
export class PublicSharesController {
  constructor(private readonly shares: SharesService, @Inject(ENV) private readonly env: Env) {}

  @Get(':token')
  view(@Param('token') token: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return this.shares.view(token, req.cookies ?? {});
  }

  @SkipCsrfToken()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':token/unlock')
  @HttpCode(204)
  async unlock(@Param('token') token: string, @Body() dto: UnlockDto, @Meta() meta: ReqMeta, @Res({ passthrough: true }) res: Response) {
    const c = await this.shares.unlock(token, dto.password, meta);
    res.cookie(c.name, c.value, {
      ...cookieBase(this.env),
      httpOnly: true,
      sameSite: 'lax',
      path: `/${this.env.API_PREFIX.replace(/^\/|\/$/g, '')}/public/shares/`,
      expires: c.expires,
    });
  }

  @Get(':token/media')
  media(@Param('token') token: string, @Query() q: PageDto, @Req() req: Request) {
    return this.shares.media(token, req.cookies ?? {}, q.cursor, q.limit);
  }

  @Get(':token/media/:mediaId/download')
  async download(@Param('token') token: string, @Param('mediaId', ParseUUIDPipe) mediaId: string, @Req() req: Request, @Meta() meta: ReqMeta, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, await this.shares.download(token, mediaId, req.cookies ?? {}, meta));
  }

  @SkipCsrfToken()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':token/zip')
  @HttpCode(200)
  zip(@Param('token') token: string, @Req() req: Request, @Meta() meta: ReqMeta) {
    return this.shares.requestZip(token, req.cookies ?? {}, meta);
  }

  @Get(':token/zip/:exportId')
  zipStatus(@Param('token') token: string, @Param('exportId', ParseUUIDPipe) exportId: string, @Req() req: Request) {
    return this.shares.zipStatus(token, exportId, req.cookies ?? {});
  }
}
