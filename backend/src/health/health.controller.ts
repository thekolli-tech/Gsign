import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { Public } from '../common/decorators/auth.decorators';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Platform health status check' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  async getHealth() {
    let dbStatus = 'disconnected';
    let redisStatus = 'disconnected';

    try {
      const res = await this.db.query('SELECT 1 as healthy');
      if (res.rows[0]?.healthy === 1) {
        dbStatus = 'connected';
      }
    } catch (e) {
      dbStatus = `error: ${e.message}`;
    }

    try {
      const pong = await this.redis.ping();
      if (pong === 'PONG') {
        redisStatus = 'connected';
      }
    } catch (e) {
      redisStatus = `error: ${e.message}`;
    }

    return {
      status: dbStatus === 'connected' && redisStatus === 'connected' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      database: dbStatus,
      redis: redisStatus,
    };
  }
}
