import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Serve uploaded images statically
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  // Enable CORS so the frontend can consume the API
  app.enableCors();

  // Standardize successful API responses globally
  app.useGlobalInterceptors(new TransformInterceptor());

  // Standardize error API responses globally
  app.useGlobalFilters(new HttpExceptionFilter());

  // Validate all incoming payloads against DTO rules
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strips non-decorated properties automatically
      transform: true, // auto-coerces parameters into validation types
    }),
  );

  // Swagger Documentation Setup
  const config = new DocumentBuilder()
    .setTitle('Moving Company API')
    .setDescription(
      'Backend API for AAAAAffordable Moving informational website. Manages services, gallery, blog posts, and contact inquiries.'
    )
    .setVersion('1.0')
    .addBearerAuth() // for Admin JWT operations
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger documentation is available at: http://localhost:${port}/api`);
}
bootstrap();
