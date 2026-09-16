import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private pool: Pool;

  constructor(configService: ConfigService) {
    let databaseUrl = configService.get<string>('DATABASE_URL');
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not defined');
    }
    // Render (and .env copies) often wrap the value in quotes; Node's URL parser rejects those.
    databaseUrl = databaseUrl.trim().replace(/^['"]|['"]$/g, '');

    const parsed = new URL(databaseUrl);
    const isRender = parsed.hostname.includes('render.com');
    // pg treats sslmode=require as verify-full, which drops Render connections.
    parsed.searchParams.delete('sslmode');
    // Render (and other TLS proxies) cannot complete SCRAM channel binding.
    parsed.searchParams.set('channel_binding', 'disable');

    const pool = new Pool({
      connectionString: parsed.toString(),
      ssl: isRender ? { rejectUnauthorized: false } : undefined,
      max: 5,
      keepAlive: true,
      connectionTimeoutMillis: 20000,
      idleTimeoutMillis: 30000,
    });
    const adapter = new PrismaPg(pool);

    super({ adapter });
    this.pool = pool;
    this.pool.on('error', (err) => {
      this.logger.error(`Unexpected PostgreSQL pool error: ${err.message}`);
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('PostgreSQL connected.');
    } catch (error) {
      this.logger.error(
        'PostgreSQL is unreachable. Please check your DATABASE_URL configuration.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
