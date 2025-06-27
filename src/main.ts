// dayssince-backend/src/main.ts
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionLoggingFilter } from './common/filters/http-exception-logging.filter';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new HttpExceptionLoggingFilter(httpAdapterHost));

  // Increase request body size limit for image uploads
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ limit: '5mb', extended: true }));

  app.setGlobalPrefix('api');
  // Enable CORS for all origins
  // src/main.ts
  app.enableCors({
    origin: process.env.FRONTEND_BASE_URL || 'http://localhost:3001', // Read from .env
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type, Accept, Authorization',
    credentials: true,
  });
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strips properties not in DTO
      transform: true, // Automatically transforms payloads to DTO instances
      forbidNonWhitelisted: true, // Optional: Throw error if extra properties are sent
      transformOptions: {
        enableImplicitConversion: true, // Allows auto-conversion for query params etc.
      },
    }),
  );
  await app.listen(3000);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
