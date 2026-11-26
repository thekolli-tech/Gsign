import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { DatabaseService } from '../database/database.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { CurrentTenant, CurrentUser } from '../common/decorators/auth.decorators';

@ApiTags('Tenants')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly sessionService: SessionService,
  ) {}

  @Get('current')
  @ApiOperation({ summary: 'Get details for the current active tenant' })
  @ApiResponse({ status: 200, description: 'Current tenant configuration' })
  async getCurrentTenant(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: any,
  ) {
    if (!tenantId) {
      if (user.isSuperAdmin || user.isPlatformOwner) {
        return {
          id: null,
          name: 'Genemax IT Solution',
          slug: 'genemax-root',
          status: 'Active',
          isRoot: true,
        };
      }
      throw new NotFoundException('No active tenant associated with this session');
    }

    const res = await this.db.query(
      `SELECT id, name, slug, cin, gstin, contact_email, contact_phone, status, created_at, updated_at
       FROM tenants WHERE id = $1`,
      [tenantId],
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
    const res = await this.db.executeAsSuperAdmin(async (client) => {
      return client.query(
        `SELECT t.id, t.name, t.slug, t.cin, t.gstin, t.contact_email, t.status, t.created_at,
                COUNT(DISTINCT tm.user_id) as member_count,
                sp.name as plan_name,
                ts.current_period_end,
                CASE
                  WHEN ts.status = 'ACTIVE' AND ts.current_period_end IS NOT NULL AND ts.current_period_end < NOW()
                    THEN 'EXPIRED'
                  ELSE ts.status
                END as subscription_status
         FROM tenants t
         LEFT JOIN tenant_memberships tm ON t.id = tm.tenant_id
         LEFT JOIN tenant_subscriptions ts ON t.id = ts.tenant_id
         LEFT JOIN subscription_plans sp ON ts.plan_id = sp.id
         GROUP BY t.id, sp.name, ts.status, ts.current_period_end
         ORDER BY t.created_at DESC`,
      );
    });
    return res.rows;
  }

  @UseGuards(SuperAdminGuard)
  @Delete(':id')
  @ApiOperation({ summary: 'Remove a tenant and revoke all its active sessions (Super Admin only)' })
  @ApiResponse({ status: 200, description: 'Tenant removed' })
  async removeTenant(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    const existing = await this.db.executeAsSuperAdmin(async (client) => {
      const res = await client.query(
        `SELECT id, name, slug FROM tenants WHERE id = $1::uuid LIMIT 1`,
        [id],
      );
      return res.rows[0] || null;
    });

    if (!existing) {
      throw new NotFoundException('Tenant not found.');
    }

    if (existing.slug === 'genemax-root') {
      throw new ForbiddenException('Root platform tenant cannot be removed.');
    }

    await this.sessionService.revokeTenantSessions(id);

    await this.db.executeAsSuperAdmin(async (client) => {
      await client.query(`DELETE FROM tenants WHERE id = $1::uuid`, [id]);
      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, reason, ip_address)
         VALUES ($1::uuid, $2::varchar, $3::varchar, 'TENANT_REMOVED', 'tenant', $4::varchar, $5::text, $6::varchar)`,
        [
          user.id,
          user.email || 'owner@gsign.in',
          user.role || 'PLATFORM_OWNER',
          id,
          `Removed tenant ${existing.name} (${existing.slug})`,
          req.ip || null,
        ],
      );
    });

    return {
      success: true,
      removed_tenant_id: id,
      name: existing.name,
    };
  }
}
