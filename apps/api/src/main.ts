import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { allowedOrigins, loadEnv } from './config/env';

// BigInt values (sizes) serialise as strings in JSON.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  const env = loadEnv(); // fail fast on bad config (§13)
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });
  app.useLogger(app.get(Logger));

  // Exactly one proxy hop (nginx) in production, so req.ip is the real client.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '1mb' });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  // Same-origin by default (the web app proxies /api); CORS only for extra origins.
  app.enableCors({ origin: allowedOrigins(env), credentials: true });
  app.setGlobalPrefix(env.API_PREFIX);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();

  if (env.SWAGGER_ENABLED && env.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('WCC Media API').setVersion('1').build());
    SwaggerModule.setup(`${env.API_PREFIX}/docs`, app, doc);
  }

  await app.listen(env.PORT, env.HOST);
}

void bootstrap();
