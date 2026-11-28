import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (redisUrl) {
      this.client = new Redis(redisUrl);
    } else {
      this.client = new Redis({
        host: this.configService.get<string>('REDIS_HOST', '127.0.0.1'),
        port: Number(this.configService.get<number>('REDIS_PORT', 6379)),
        password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
      });
    }
  }

  async onModuleInit() {
    try {
      await this.client.connect();
      this.logger.log('Redis client connected successfully.');
    } catch (err) {
      this.logger.warn('Failed to connect to Redis directly, will retry in background:', err.message);
    }
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  getClient(): Redis {
    return this.client;
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async getdel(key: string): Promise<string | null> {
    if (typeof (this.client as any).getdel === 'function') {
      return (this.client as any).getdel(key);
    }
    const res = await this.client.eval(
      "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]); end; return v;",
      1,
      key,
    );
    return (res as string | null) ?? null;
  }

  async set(key: string, value: string): Promise<'OK'> {
    return this.client.set(key, value);
  }

  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    return this.client.setex(key, seconds, value);
  }

  async del(key: string | string[]): Promise<number> {
    if (Array.isArray(key)) {
      if (key.length === 0) return 0;
      return this.client.del(...key);
    }
    return this.client.del(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }
}
