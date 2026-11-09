import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ENV, Env } from '../config/env';
import { AllowPending2fa, CurrentUser, Meta, Public, ReqMeta, SkipCsrfToken } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { REFRESH_COOKIE } from '../common/guards';
import { AuthService } from './auth.service';
import { clearAuthCookies, setAuthCookies } from './cookies';
import { ChangeEmailDto, ChangePasswordDto, Disable2faDto, EmailDto, LoginDto, ResetPasswordDto, TokenDto, TotpDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, @Inject(ENV) private readonly env: Env) {}

  @Public()
  @SkipCsrfToken() // no session yet: Origin check only (§7.4)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Meta() meta: ReqMeta, @Res({ passthrough: true }) res: Response) {
    const { tokens, userId } = await this.auth.login(dto, meta);
    setAuthCookies(res, this.env, tokens);
    return { user: await this.auth.meFor(userId) };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Meta() meta: ReqMeta, @Res({ passthrough: true }) res: Response) {
    try {
      const r = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE] as string | undefined, meta);
      setAuthCookies(res, this.env, r.tokens);
      return { ok: true };
    } catch (e) {
      if ((e as { response?: { code?: string } }).response?.code !== 'REFRESH_RACE') clearAuthCookies(res, this.env);
      throw e;
    }
  }

  @AllowPending2fa()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Meta() meta: ReqMeta, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user, meta);
    clearAuthCookies(res, this.env);
  }

  @AllowPending2fa()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.meFor(user.id);
  }

  @Public()
  @SkipCsrfToken()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(204)
  async forgot(@Body() dto: EmailDto, @Meta() meta: ReqMeta) {
    await this.auth.forgotPassword(dto.email, meta);
  }

  @Public()
  @SkipCsrfToken()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(204)
  async reset(@Body() dto: ResetPasswordDto, @Meta() meta: ReqMeta) {
    await this.auth.resetPassword(dto.token, dto.password, meta);
  }

  @AllowPending2fa()
  @Post('change-password')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Meta() meta: ReqMeta) {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword, meta);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('change-email')
  @HttpCode(200)
  changeEmail(@CurrentUser() user: AuthUser, @Body() dto: ChangeEmailDto, @Meta() meta: ReqMeta) {
    return this.auth.requestEmailChange(user, dto.newEmail, dto.password, meta);
  }

  @Get('change-email')
  pendingEmail(@CurrentUser() user: AuthUser) {
    return this.auth.pendingEmailChange(user).then((p) => p ?? { pendingEmail: null, expiresAt: null });
  }

  @Delete('change-email')
  @HttpCode(204)
  async cancelEmail(@CurrentUser() user: AuthUser) {
    await this.auth.cancelEmailChange(user);
  }

  @Public()
  @SkipCsrfToken()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-email')
  @HttpCode(200)
  verifyEmail(@Body() dto: TokenDto, @Meta() meta: ReqMeta, @Res({ passthrough: true }) res: Response) {
    return this.auth.verifyEmailChange(dto.token, meta).then((r) => (clearAuthCookies(res, this.env), r));
  }

  @AllowPending2fa()
  @Post('2fa/setup')
  @HttpCode(200)
  setup(@CurrentUser() user: AuthUser) {
    return this.auth.setup2fa(user);
  }

  @AllowPending2fa()
  @Post('2fa/enable')
  @HttpCode(200)
  enable(@CurrentUser() user: AuthUser, @Body() dto: TotpDto, @Meta() meta: ReqMeta) {
    return this.auth.enable2fa(user, dto.totp, meta);
  }

  @Post('2fa/disable')
  @HttpCode(204)
  async disable(@CurrentUser() user: AuthUser, @Body() dto: Disable2faDto, @Meta() meta: ReqMeta) {
    await this.auth.disable2fa(user, dto.password, dto.totp, meta);
  }

  @AllowPending2fa()
  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user);
  }

  @AllowPending2fa()
  @Delete('sessions/:id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    await this.auth.revokeSession(user, id, meta);
  }
}
