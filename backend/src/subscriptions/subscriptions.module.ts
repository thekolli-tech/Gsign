import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { PlatformOwnerGuard } from '../common/guards/platform-owner.guard';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, PlatformOwnerGuard],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
