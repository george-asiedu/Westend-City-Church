import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class LoginDto {
  /** Email address or phone number (members who joined with a QR code may have no email). */
  @Transform(trimLower)
  @Matches(/^([^@\s]+@[^@\s]+\.[^@\s]+|[+\d\s()-]{9,20})$/, { message: 'Enter your email address or 10-digit phone number' })
  @MaxLength(254)
  email!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
  @IsOptional() @IsString() @MaxLength(20) totp?: string;
}

export class EmailDto {
  @Transform(trimLower) @IsEmail() @MaxLength(254) email!: string;
}

export class ResetPasswordDto {
  @IsString() @MaxLength(200) token!: string;
  @IsString() @MaxLength(200) password!: string;
}

export class ChangePasswordDto {
  @IsString() @MaxLength(200) currentPassword!: string;
  @IsString() @MaxLength(200) newPassword!: string;
}

export class ChangeEmailDto {
  @Transform(trimLower) @IsEmail() @MaxLength(254) newEmail!: string;
  @IsString() @MaxLength(200) password!: string;
}

export class TokenDto {
  @IsString() @MaxLength(200) token!: string;
}

export class TotpDto {
  @Matches(/^\d{6}$/) totp!: string;
}

export class Disable2faDto {
  @IsString() @MaxLength(200) password!: string;
  @Matches(/^\d{6}$/) totp!: string;
}
