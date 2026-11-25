import { Controller, Get, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { CurrentTenant, CurrentUser } from '../common/decorators/auth.decorators';

@ApiTags('Tenants')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('tenants')
export class TenantsController {
  constructor(private readonly db: DatabaseService) {}

  @Get('current')
  @ApiOperation({ summary: 'Get details for the current active tenant' })
  @ApiResponse({ status: 200, description: 'Current tenant configuration' })
  async getCurrentTenant(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: any
  ) {
    if (!tenantId) {
      if (user.isSuperAdmin) {
        return {
          id: null,
          name: 'GSIGN Global Root',
          slug: 'root',
          status: 'Active',
          isRoot: true,
        };
      }
      throw new NotFoundException('No active tenant associated with this session');
    }

    const res = await this.db.query(
      `SELECT id, name, slug, cin, gstin, contact_email, contact_phone, status, created_at, updated_at
       FROM tenants WHERE id = $1`,
      [tenantId]
    );

    if (res.rows.length === 0) {
      throw new NotFoundException('Tenant not found');
    }

    return res.rows[0];
  }

  @UseGuards(SuperAdminGuard)
  @Get()
  @ApiOperation({ summary: 'List all platform tenants (Super Admin only)' })
  @ApiResponse({ status: 200, description: 'All tenants' })
  async getAllTenants() {
    const res = await this.db.query(
      `SELECT t.id, t.name, t.slug, t.cin, t.gstin, t.contact_email, t.status, t.created_at,
              COUNT(DISTINCT tm.user_id) as member_count
       FROM tenants t
       LEFT JOIN tenant_memberships tm ON t.id = tm.tenant_id
       GROUP BY t.id
       ORDER BY t.created_at DESC`
    );
    return res.rows;
  }
}
