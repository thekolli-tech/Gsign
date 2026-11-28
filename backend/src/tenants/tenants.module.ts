import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { SalesInquiriesService } from './sales-inquiries.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [TenantsController],
  providers: [PlatformAnalyticsService, SalesInquiriesService],
})
export class TenantsModule {}
