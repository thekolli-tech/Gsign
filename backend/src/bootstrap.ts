import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

export async function createNestApp() {
  const app = await NestFactory.create(AppModule);

  // 1. Security Headers with Helmet
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          scriptSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      frameguard: { action: 'deny' },
      hidePoweredBy: true,
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    })
  );

  // 2. Cookie Parser for __Host-gsign_session & gsign_session
  app.use(cookieParser());

  // 3. CORS Configuration
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:5173', 'http://localhost:4173'];

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Session-ID'],
  });

  // 4. Global API Prefix (api/v1)
  const rawPrefix = process.env.API_PREFIX || 'api/v1';
  const apiPrefix = rawPrefix.replace(/^\/+|\/+$/g, '');
  app.setGlobalPrefix(apiPrefix);

  // 5. Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    })
  );

  // 6. Global Exception Filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // 7. Swagger / OpenAPI 3.0 Documentation
  const config = new DocumentBuilder()
    .setTitle('GSIGN API')
    .setDescription(
      'Enterprise Digital Agreement Management & Electronic Signature Platform REST API — Milestone 1 Foundation'
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Token',
        name: 'Session',
        description: 'Enter your 256-bit session token',
        in: 'header',
      },
      'bearer'
    )
    .addCookieAuth('gsign_session', {
      type: 'apiKey',
      in: 'cookie',
      name: 'gsign_session',
      description: 'HttpOnly Secure Session Cookie',
    })
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  return { app, apiPrefix };
}

export async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const { app, apiPrefix } = await createNestApp();

  // 8. Start Listening
  const port = Number(process.env.PORT) || 3001;
  await app.listen(port, '0.0.0.0');

  logger.log(`=======================================================`);
  logger.log(`  GSIGN Backend Service is running on: http://localhost:${port}/${apiPrefix}`);
  logger.log(`  OpenAPI Swagger Docs available at: http://localhost:${port}/${apiPrefix}/docs`);
  logger.log(`  Health Check URL: http://localhost:${port}/${apiPrefix}/health`);
  logger.log(`=======================================================`);
}
