import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { SubscriptionGuard } from '../common/guards/subscription.guard';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [SubscriptionGuard, PermissionsGuard],
})
export class UsersModule {}
