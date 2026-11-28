import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { EmailService } from './email.service';

@Global()
@Module({
  imports: [DatabaseModule, RedisModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class NotificationsModule {}
