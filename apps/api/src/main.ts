import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import type { Env } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const config = app.get(ConfigService<Env, true>);

  // Derrière un reverse proxy de confiance uniquement : sinon l'IP client
  // utilisée pour l'audit et la limitation de débit serait falsifiable.
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', config.get('TRUST_PROXY', { infer: true }));

  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('API Tontine')
    .setDescription('API de la plateforme de tontine en ligne (Cameroun, XAF)')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig), {
    jsonDocumentUrl: 'docs-json',
  });

  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);

  app.get(Logger).log(`API démarrée sur ${await app.getUrl()} (docs: /docs, health: /health)`);
}

void bootstrap();
