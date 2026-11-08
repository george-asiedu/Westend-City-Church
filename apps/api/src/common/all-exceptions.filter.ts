import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@wcc/db';
import type { Request, Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';

const CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'TOO_MANY_REQUESTS',
};

/** One error envelope; never leaks stack traces or Prisma internals (§10). */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = String(req.id ?? '');

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong';
    let details: unknown;

    if (exception instanceof ThrottlerException) {
      status = 429;
      code = 'TOO_MANY_REQUESTS';
      message = 'Too many requests. Please wait a moment.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = CODES[status] ?? 'ERROR';
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object') {
        const b = body as { code?: string; message?: string | string[]; details?: unknown };
        if (b.code) code = b.code;
        if (Array.isArray(b.message)) {
          code = b.code ?? 'VALIDATION_FAILED';
          message = 'Some fields are invalid';
          details = b.message;
        } else if (b.message) message = b.message;
        if (b.details) details = b.details;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = 409;
        code = 'CONFLICT';
        message = 'That already exists';
      } else if (exception.code === 'P2025') {
        status = 404;
        code = 'NOT_FOUND';
        message = 'Not found';
      } else this.logger.error(exception);
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    res.status(status).json({ statusCode: status, code, message, details, requestId });
  }
}
