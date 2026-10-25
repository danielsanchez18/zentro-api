import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`🚀 Zentro API running on http://localhost:${port}`);
}

void bootstrap();
