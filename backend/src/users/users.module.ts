import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionGuard } from '../common/guards/subscription.guard';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [SubscriptionGuard],
})
export class UsersModule {}
