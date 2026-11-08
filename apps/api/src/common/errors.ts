import { HttpException, HttpStatus } from '@nestjs/common';

/** HttpException with a stable machine-readable code (§17.6). */
export class AppException extends HttpException {
  constructor(status: HttpStatus, public readonly code: string, message: string, public readonly details?: unknown) {
    super({ statusCode: status, code, message, details }, status);
  }
}

export const notFound = (what = 'Resource') => new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You do not have permission to do that') =>
  new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppException(HttpStatus.BAD_REQUEST, code, message, details);
export const conflict = (code: string, message: string) => new AppException(HttpStatus.CONFLICT, code, message);
export const unauthorized = (code = 'UNAUTHORIZED', message = 'Please sign in') =>
  new AppException(HttpStatus.UNAUTHORIZED, code, message);
