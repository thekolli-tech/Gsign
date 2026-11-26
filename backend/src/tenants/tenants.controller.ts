import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import * as crypto from 'crypto';
import { Request } from 'express';
import { CryptoService } from '../auth/crypto.service';
import { SessionService } from '../auth/session.service';
import { DatabaseService } from '../database/database.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { CurrentTenant, CurrentUser } from '../common/decorators/auth.decorators';

export class CreateTenantByOwnerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  company_name!: string;

  @IsEmail()
  @MaxLength(255)
  admin_email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  admin_password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  admin_full_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  plan_slug?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  duration_months?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  domain?: string;
}

@ApiTags('Tenants')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly sessionService: SessionService,
    private readonly cryptoService: CryptoService,
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
  @Post()
  @ApiOperation({ summary: 'Provision a new tenant and its Company Admin (Super Admin only)' })
  @ApiResponse({ status: 201, description: 'Tenant provisioned' })
  async createTenant(
    @Body() dto: CreateTenantByOwnerDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    const companyName = dto.company_name.trim();
    const adminEmail = dto.admin_email.trim().toLowerCase();
    const planSlug = (dto.plan_slug || 'business').trim().toLowerCase();
    const durationMonths = dto.duration_months ?? 1;

    const baseSlug =
      dto.domain?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') ||
      companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ||
      'tenant';
    const uniqueSlug = `${baseSlug.slice(0, 48)}-${crypto.randomBytes(2).toString('hex')}`;
    const passwordHash = await this.cryptoService.hashPassword(dto.admin_password);

    return this.db.executeAsSuperAdmin(async (client) => {
      const existingUser = await client.query(
        `SELECT id FROM users WHERE email = $1 LIMIT 1`,
        [adminEmail],
      );
      if (existingUser.rows.length > 0) {
        throw new ConflictException(`A user with email ${adminEmail} already exists.`);
      }

      const planRes = await client.query(
        `SELECT id, name FROM subscription_plans WHERE slug = $1 AND is_active = true LIMIT 1`,
        [planSlug],
      );
      if (planRes.rows.length === 0) {
        throw new BadRequestException(`Active subscription plan '${planSlug}' not found.`);
      }
      const plan = planRes.rows[0];

      const roleRes = await client.query(
        `SELECT id FROM roles WHERE name = 'Company Admin' LIMIT 1`,
      );
      if (roleRes.rows.length === 0) {
        throw new BadRequestException("System role 'Company Admin' not found.");
      }

      const tenantRes = await client.query(
        `INSERT INTO tenants (name, slug, contact_email, contact_phone, status)
         VALUES ($1, $2, $3, '+91 00000 00000', 'Active')
         RETURNING id, name, slug, contact_email, status, created_at`,
        [companyName, uniqueSlug, adminEmail],
      );
      const tenant = tenantRes.rows[0];

      const userRes = await client.query(
        `INSERT INTO users (
           email, password_hash, full_name, is_super_admin, is_platform_owner,
           must_change_password, is_active, email_verified_at
         ) VALUES ($1, $2, $3, false, false, false, true, NOW())
         RETURNING id`,
        [adminEmail, passwordHash, dto.admin_full_name?.trim() || `${companyName} Admin`],
      );
      const adminUserId = userRes.rows[0].id;

      await client.query(
        `INSERT INTO tenant_memberships (tenant_id, user_id, role_id, department, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'Executive', 'Active')`,
        [tenant.id, adminUserId, roleRes.rows[0].id],
      );

      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + durationMonths);

      await client.query(
        `INSERT INTO tenant_subscriptions (
           tenant_id, plan_id, billing_cycle, status, current_period_start, current_period_end
         ) VALUES ($1::uuid, $2::uuid, $3::varchar, 'ACTIVE', NOW(), $4::timestamptz)`,
        [tenant.id, plan.id, durationMonths >= 12 ? 'annual' : 'monthly', periodEnd],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1::uuid, $2::varchar, $3::varchar, 'TENANT_PROVISIONED_BY_OWNER', 'tenant', $4::varchar, $5::uuid, $6::text, $7::varchar)`,
        [
          user.id,
          user.email || 'owner@gsign.in',
          user.role || 'PLATFORM_OWNER',
          tenant.id,
          tenant.id,
          `Provisioned ${companyName} (${plan.name}, ${durationMonths} month(s))`,
          req.ip || null,
        ],
      );

      return {
        ...tenant,
        plan_name: plan.name,
        subscription_status: 'ACTIVE',
        current_period_end: periodEnd.toISOString(),
        admin_email: adminEmail,
      };
    });
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
