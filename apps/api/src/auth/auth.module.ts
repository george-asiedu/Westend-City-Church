import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ENV, Env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MeService } from './me.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ENV],
      useFactory: (env: Env) => ({ secret: env.JWT_ACCESS_SECRET, signOptions: { algorithm: 'HS256' } }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, MeService, PasswordService, SessionService, TotpService],
  exports: [PasswordService, SessionService, MeService],
})
export class AuthModule {}
