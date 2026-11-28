import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsBoolean,
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
import * as dns from 'dns/promises';
import { Request } from 'express';
import { CryptoService } from '../auth/crypto.service';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { PlatformOwnerGuard } from '../common/guards/platform-owner.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { CurrentTenant, CurrentUser, Public } from '../common/decorators/auth.decorators';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { SalesInquiriesService } from './sales-inquiries.service';
import { CreateSalesInquiryDto, UpdateSalesInquiryDto } from './dto/sales-inquiry.dto';

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

class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  logoText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_000_000)
  logoUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  brandColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  emailDisplayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customDomain?: string;

  @IsOptional()
  @IsBoolean()
  dnsVerified?: boolean;

  @IsOptional()
  @IsBoolean()
  hidePoweredBy?: boolean;
}

class VerifyDomainDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  domain!: string;
}

@ApiTags('Tenants')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly cryptoService: CryptoService,
    @Optional() private readonly platformAnalytics?: PlatformAnalyticsService,
    @Optional() private readonly salesInquiries?: SalesInquiriesService,
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
      `SELECT t.id, t.name, t.slug, t.cin, t.gstin, t.contact_email, t.contact_phone, t.status, (to_jsonb(t)->>'deleted_at') AS deleted_at, t.created_at, t.updated_at
       FROM tenants t WHERE t.id = $1`,
      [tenantId],
    );

    if (res.rows.length === 0) {
      throw new NotFoundException('Tenant not found');
    }
    const tenant = res.rows[0];
    if (tenant.deleted_at || tenant.status === 'Archived') {
      throw new ForbiddenException('This company workspace has been archived.');
    }

    return tenant;
  }

  @Get('current/branding')
  @ApiOperation({ summary: 'Get persisted branding & custom domain settings for the current tenant' })
  async getCurrentBranding(@CurrentTenant() tenantId: string | null) {
    if (!tenantId) {
      return {};
    }
    const res = await this.db.query(
      `SELECT branding_json FROM tenants WHERE id = $1::uuid LIMIT 1`,
      [tenantId],
    );
    return res.rows[0]?.branding_json || {};
  }

  @Patch('current/branding')
  @ApiOperation({ summary: 'Persist branding & custom domain settings for the current tenant' })
  async updateCurrentBranding(
    @CurrentTenant() tenantId: string | null,
    @Body() dto: UpdateBrandingDto,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant context is required to save workspace branding.');
    }

    const existingRes = await this.db.query(
      `SELECT branding_json FROM tenants WHERE id = $1::uuid LIMIT 1`,
      [tenantId],
    );
    if (existingRes.rows.length === 0) {
      throw new NotFoundException('Tenant not found');
    }

    const prev = existingRes.rows[0]?.branding_json || {};
    const nextDomain =
      dto.customDomain !== undefined
        ? dto.customDomain.trim().toLowerCase()
        : (prev.customDomain || '');
    const domainChanged =
      dto.customDomain !== undefined &&
      nextDomain !== (prev.customDomain || '').trim().toLowerCase();

    const merged = {
      logoText: dto.logoText !== undefined ? dto.logoText.trim() : prev.logoText,
      logoUrl: dto.logoUrl === null ? undefined : (dto.logoUrl !== undefined ? dto.logoUrl : prev.logoUrl),
      brandColor: dto.brandColor !== undefined ? dto.brandColor.trim() : prev.brandColor,
      emailDisplayName: dto.emailDisplayName !== undefined ? dto.emailDisplayName.trim() : prev.emailDisplayName,
      customDomain: nextDomain,
      dnsVerified: domainChanged
        ? false
        : (dto.dnsVerified !== undefined ? dto.dnsVerified : Boolean(prev.dnsVerified)),
      hidePoweredBy: dto.hidePoweredBy !== undefined ? dto.hidePoweredBy : Boolean(prev.hidePoweredBy),
      updatedAt: new Date().toISOString(),
    };

    await this.db.query(
      `UPDATE tenants SET branding_json = $2::jsonb, updated_at = NOW() WHERE id = $1::uuid`,
      [tenantId, JSON.stringify(merged)],
    );

    return merged;
  }

  @Post('current/verify-domain')
  @ApiOperation({ summary: 'Perform real-time DNS verification for a custom domain' })
  async verifyCurrentDomain(
    @CurrentTenant() tenantId: string | null,
    @Body() dto: VerifyDomainDto,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant context is required to verify a custom domain.');
    }

    const domain = dto.domain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
      throw new BadRequestException('Enter a valid domain hostname (e.g. sign.company.com).');
    }

    let cnameRecords: string[] = [];
    let aRecords: string[] = [];
    let aaaaRecords: string[] = [];

    try {
      cnameRecords = await dns.resolveCname(domain);
    } catch {
      cnameRecords = [];
    }
    try {
      aRecords = await dns.resolve4(domain);
    } catch {
      aRecords = [];
    }
    try {
      aaaaRecords = await dns.resolve6(domain);
    } catch {
      aaaaRecords = [];
    }

    const hasLiveIp = aRecords.length > 0 || aaaaRecords.length > 0;
    const verified = cnameRecords.length > 0 || hasLiveIp;

    const existingRes = await this.db.query(
      `SELECT branding_json FROM tenants WHERE id = $1::uuid LIMIT 1`,
      [tenantId],
    );
    const prev = existingRes.rows[0]?.branding_json || {};
    const merged = {
      ...prev,
      customDomain: domain,
      dnsVerified: verified,
      verifiedAt: verified ? new Date().toISOString() : null,
    };
    await this.db.query(
      `UPDATE tenants SET branding_json = $2::jsonb, updated_at = NOW() WHERE id = $1::uuid`,
      [tenantId, JSON.stringify(merged)],
    );

    return {
      verified,
      domain,
      cnameRecords,
      aRecords,
      aaaaRecords,
      message: verified
        ? `DNS verified for ${domain} (${cnameRecords[0] || aRecords[0] || aaaaRecords[0] || 'active DNS'}).`
        : `No active DNS records found for ${domain}. Ensure the domain exists and has valid DNS records, then retry.`,
    };
  }

  @UseGuards(SuperAdminGuard)
  @Get()
  @ApiOperation({ summary: 'List platform tenants (Super Admin only)' })
  @ApiResponse({ status: 200, description: 'Platform tenants' })
  async getAllTenants(@Query('include_archived') includeArchived?: string) {
    const showArchived = includeArchived === 'true';
    const res = await this.db.executeAsSuperAdmin(async (client) => {
      return client.query(
        `SELECT t.id, t.name, t.slug, t.cin, t.gstin, t.contact_email, t.status, (to_jsonb(t)->>'deleted_at') AS deleted_at, t.created_at,
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
         ${showArchived ? '' : "WHERE (to_jsonb(t)->>'deleted_at') IS NULL AND t.status <> 'Archived'"}
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
  @ApiOperation({ summary: 'Soft-delete/archive a tenant, preserve historical records, and revoke all sessions (Super Admin only)' })
  @ApiResponse({ status: 200, description: 'Tenant archived safely' })
  async removeTenant(
    @Param('id') id: string,
    @Query('confirm') confirmQuery: string | undefined,
    @Body() body: { confirm?: boolean } | undefined,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    if (confirmQuery !== 'true' && body?.confirm !== true) {
      throw new BadRequestException(
        'Explicit confirmation is required to archive a tenant (confirm=true).',
      );
    }

    const outcome = await this.db.executeAsSuperAdmin(async (client) => {
      const res = await client.query(
        `SELECT t.id, t.name, t.slug, t.status, (to_jsonb(t)->>'deleted_at') AS deleted_at
         FROM tenants t
         WHERE t.id = $1::uuid
         FOR UPDATE`,
        [id],
      );
      const existing = res.rows[0];
      if (!existing) {
        throw new NotFoundException('Tenant not found.');
      }
      if (existing.slug === 'genemax-root') {
        throw new ForbiddenException('Root platform tenant cannot be archived.');
      }

      if (existing.deleted_at || existing.status === 'Archived') {
        return {
          alreadyArchived: true,
          name: existing.name,
          deletedAt: existing.deleted_at,
          revokedSessionIds: [] as string[],
        };
      }

      // 1. Soft-delete / archive tenant (preserving all historical records & foreign keys)
      const colRes = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'deleted_at'
         LIMIT 1`,
      );
      const hasDeletedAtCol = colRes.rows.length > 0;
      const updTenant = hasDeletedAtCol
        ? await client.query(
            `UPDATE tenants
             SET status = 'Archived', deleted_at = NOW(), deleted_by = $2::uuid, updated_at = NOW()
             WHERE id = $1::uuid
             RETURNING deleted_at`,
            [id, user.id],
          )
        : await client.query(
            `UPDATE tenants
             SET status = 'Archived', updated_at = NOW()
             WHERE id = $1::uuid
             RETURNING updated_at AS deleted_at`,
            [id],
          );

      // 2. Deactivate tenant memberships
      await client.query(
        `UPDATE tenant_memberships
         SET status = 'Inactive', updated_at = NOW()
         WHERE tenant_id = $1::uuid AND status <> 'Inactive'`,
        [id],
      );

      // 3. Expire pending invitations
      await client.query(
        `UPDATE invitations
         SET expires_at = NOW()
         WHERE tenant_id = $1::uuid AND accepted_at IS NULL AND expires_at > NOW()`,
        [id],
      );

      // 4. Cancel active subscriptions
      await client.query(
        `UPDATE tenant_subscriptions
         SET status = 'CANCELLED', cancelled_at = COALESCE(cancelled_at, NOW()), updated_at = NOW()
         WHERE tenant_id = $1::uuid AND status NOT IN ('CANCELLED', 'EXPIRED')`,
        [id],
      );

      // 5. Revoke active signing requests & pending recipients (if signing tables exist)
      const sigTablesRes = await client.query(
        `SELECT to_regclass('public.signing_requests') IS NOT NULL AS has_requests,
                to_regclass('public.signing_recipients') IS NOT NULL AS has_recipients`,
      );
      if (sigTablesRes.rows[0]?.has_requests) {
        await client.query(
          `UPDATE signing_requests
           SET status = 'REVOKED', revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW()
           WHERE tenant_id = $1::uuid AND status = 'ACTIVE'`,
          [id],
        );
      }
      if (sigTablesRes.rows[0]?.has_recipients) {
        await client.query(
          `UPDATE signing_recipients
           SET status = 'REVOKED', revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW()
           WHERE tenant_id = $1::uuid AND status IN ('PENDING', 'OTP_VERIFIED')`,
          [id],
        );
      }

      // 6. Revoke all active sessions in PostgreSQL
      const sessRes = await client.query(
        `UPDATE sessions
         SET revoked_at = NOW()
         WHERE tenant_id = $1::uuid AND revoked_at IS NULL
         RETURNING id`,
        [id],
      );

      // 7. Record immutable TENANT_REMOVED audit event
      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address, metadata)
         VALUES ($1::uuid, $2::varchar, $3::varchar, 'TENANT_REMOVED', 'tenant', $4::varchar, $5::uuid, $6::text, $7::varchar, $8::jsonb)`,
        [
          user.id,
          user.email || 'owner@gsign.in',
          user.role || 'PLATFORM_OWNER',
          id,
          id,
          `Soft-deleted/archived tenant ${existing.name} (${existing.slug})`,
          req.ip || null,
          JSON.stringify({
            revoked_sessions: sessRes.rows.length,
            preserved_history: true,
          }),
        ],
      );

      return {
        alreadyArchived: false,
        name: existing.name,
        deletedAt: updTenant.rows[0].deleted_at,
        revokedSessionIds: sessRes.rows.map((r) => r.id as string),
      };
    });

    // Purge Redis sessions after DB transaction commits
    if (outcome.revokedSessionIds.length > 0) {
      await this.redis.del(outcome.revokedSessionIds.map((sid) => `session:${sid}`));
    }

    return {
      success: true,
      already_archived: outcome.alreadyArchived,
      removed_tenant_id: id,
      name: outcome.name,
      status: 'Archived',
      deleted_at: outcome.deletedAt,
    };
  }

  @UseGuards(SuperAdminGuard)
  @Get('platform/integrations')
  @ApiOperation({ summary: 'Live status of infrastructure and third-party eSign gateways (Super Admin only)' })
  async getPlatformIntegrations() {
    let dbConnected = false;
    try {
      await this.db.query('SELECT 1');
      dbConnected = true;
    } catch {
      dbConnected = false;
    }

    let redisConnected = false;
    try {
      const pong = await this.redis.getClient().ping();
      redisConnected = pong === 'PONG';
    } catch {
      redisConnected = false;
    }

    const r2Configured = Boolean(
      process.env.S3_BUCKET &&
        process.env.S3_ENDPOINT &&
        process.env.S3_ACCESS_KEY_ID &&
        process.env.S3_SECRET_ACCESS_KEY,
    );
    const resendConfigured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
    const aadhaarConfigured = Boolean(process.env.AADHAAR_ESIGN_API_KEY);
    const signdeskConfigured = Boolean(process.env.SIGNDESK_API_KEY);
    const digilockerConfigured = Boolean(process.env.DIGILOCKER_CLIENT_ID);

    return [
      {
        id: 'postgres',
        name: 'PostgreSQL (Neon)',
        category: 'Core Database',
        connected: dbConnected,
        status: dbConnected ? 'Connected' : 'Disconnected',
        details: dbConnected ? 'Primary relational database with RLS active.' : 'Database connection check failed.',
      },
      {
        id: 'redis',
        name: 'Redis Session & Rate-Limit Store',
        category: 'Cache & Sessions',
        connected: redisConnected,
        status: redisConnected ? 'Connected' : 'Disconnected',
        details: redisConnected ? 'Active session revocation & login rate limiting.' : 'Redis ping failed.',
      },
      {
        id: 'r2',
        name: 'Cloudflare R2 Private Storage',
        category: 'Document Storage',
        connected: r2Configured,
        status: r2Configured ? 'Connected' : 'Not Configured',
        details: r2Configured
          ? `Private bucket '${process.env.S3_BUCKET}' configured.`
          : 'S3/R2 environment variables are not configured.',
      },
      {
        id: 'resend',
        name: 'Resend Transactional Email',
        category: 'Email Delivery',
        connected: resendConfigured,
        status: resendConfigured ? 'Connected' : 'Not Configured',
        details: resendConfigured
          ? `Sender configured: ${process.env.EMAIL_FROM}`
          : 'RESEND_API_KEY or EMAIL_FROM is missing.',
      },
      {
        id: 'aadhaar_esign',
        name: 'Aadhaar eSign (NSDL / CDSL)',
        category: 'eSign Gateway',
        connected: aadhaarConfigured,
        status: aadhaarConfigured ? 'Connected' : 'Not Configured',
        details: aadhaarConfigured
          ? 'ASP gateway credentials configured.'
          : 'No integration configured yet. Requires ASP credentials (AADHAAR_ESIGN_API_KEY).',
      },
      {
        id: 'signdesk',
        name: 'SignDesk Gateway',
        category: 'eSign Gateway',
        connected: signdeskConfigured,
        status: signdeskConfigured ? 'Connected' : 'Not Configured',
        details: signdeskConfigured
          ? 'SignDesk API credentials configured.'
          : 'No integration configured yet. Requires SIGNDESK_API_KEY.',
      },
      {
        id: 'digilocker',
        name: 'DigiLocker Verification',
        category: 'Identity & KYC',
        connected: digilockerConfigured,
        status: digilockerConfigured ? 'Connected' : 'Not Configured',
        details: digilockerConfigured
          ? 'DigiLocker OAuth client configured.'
          : 'No integration configured yet. Requires DIGILOCKER_CLIENT_ID.',
      },
    ];
  }

  @UseGuards(SuperAdminGuard)
  @Get('platform/support-access')
  @ApiOperation({ summary: 'List audit-logged support access sessions (Super Admin only)' })
  async getSupportAccessSessions() {
    const res = await this.db.executeAsSuperAdmin(async (client) => {
      await client.query(
        `UPDATE support_access_sessions SET status = 'Expired' WHERE status = 'Active' AND expires_at <= NOW()`,
      );
      return client.query(
        `SELECT s.id, s.tenant_id, t.name AS tenant_name, s.granted_by_email,
                s.reason, s.status, s.expires_at, s.revoked_at, s.created_at
         FROM support_access_sessions s
         JOIN tenants t ON t.id = s.tenant_id
         ORDER BY s.created_at DESC
         LIMIT 50`,
      );
    });
    return res.rows;
  }

  @UseGuards(SuperAdminGuard)
  @Post('platform/support-access')
  @ApiOperation({ summary: 'Grant a time-boxed, audit-logged support access session (Super Admin only)' })
  async grantSupportAccess(
    @Body() body: { tenant_id: string; reason: string; duration_minutes?: number },
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    if (!body?.tenant_id || !body?.reason?.trim()) {
      throw new BadRequestException('Tenant and mandatory audit reason are required.');
    }
    const mins = Math.min(Math.max(Number(body.duration_minutes) || 30, 5), 240);

    const res = await this.db.executeAsSuperAdmin(async (client) => {
      const ins = await client.query(
        `INSERT INTO support_access_sessions (tenant_id, granted_by, granted_by_email, reason, status, expires_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, 'Active', NOW() + ($5 || ' minutes')::interval)
         RETURNING *`,
        [body.tenant_id, user.id, user.email || 'owner@gsign.in', body.reason.trim(), String(mins)],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1::uuid, $2, $3, 'SUPPORT_ACCESS_GRANTED', 'tenant', $4, $5::uuid, $6, $7)`,
        [user.id, user.email || 'owner@gsign.in', user.role || 'PLATFORM_OWNER', body.tenant_id, body.tenant_id, body.reason.trim(), req.ip || null],
      );
      return ins.rows[0];
    });
    return res;
  }

  @UseGuards(SuperAdminGuard)
  @Post('platform/support-access/:id/revoke')
  @ApiOperation({ summary: 'Revoke an active support access session (Super Admin only)' })
  async revokeSupportAccess(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    const res = await this.db.executeAsSuperAdmin(async (client) => {
      const upd = await client.query(
        `UPDATE support_access_sessions
         SET status = 'Revoked', revoked_at = NOW()
         WHERE id = $1::uuid AND status = 'Active'
         RETURNING *`,
        [id],
      );
      if (upd.rows.length === 0) {
        throw new NotFoundException('Active support session not found.');
      }
      const row = upd.rows[0];
      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1::uuid, $2, $3, 'SUPPORT_ACCESS_REVOKED', 'support_session', $4, $5::uuid, 'Support session revoked by Super Admin', $6)`,
        [user.id, user.email || 'owner@gsign.in', user.role || 'PLATFORM_OWNER', id, row.tenant_id, req.ip || null],
      );
      return row;
    });
    return res;
  }

  @UseGuards(SuperAdminGuard)
  @Get('platform/feature-flags')
  @ApiOperation({ summary: 'List per-tenant feature flags (Super Admin only)' })
  async getPlatformFeatureFlags() {
    const res = await this.db.executeAsSuperAdmin(async (client) => {
      return client.query(
        `SELECT t.id, t.name, t.slug, t.status, t.feature_flags_json, sp.name AS plan_name
         FROM tenants t
         LEFT JOIN tenant_subscriptions ts ON ts.tenant_id = t.id
         LEFT JOIN subscription_plans sp ON sp.id = ts.plan_id
         WHERE (to_jsonb(t)->>'deleted_at') IS NULL AND t.status <> 'Archived'
         ORDER BY t.created_at DESC`,
      );
    });
    const defaults = {
      custom_branding: true,
      custom_domain: true,
      templates_library: true,
      otp_signing: true,
      api_access: false,
      aadhaar_esign: false,
    };
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      plan_name: r.plan_name || 'Starter',
      flags: { ...defaults, ...(r.feature_flags_json || {}) },
    }));
  }

  @UseGuards(SuperAdminGuard)
  @Patch('platform/feature-flags/:tenantId')
  @ApiOperation({ summary: 'Update feature flags for a tenant (Super Admin only)' })
  async updateTenantFeatureFlags(
    @Param('tenantId') tenantId: string,
    @Body() body: { flags: Record<string, boolean> },
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    const res = await this.db.executeAsSuperAdmin(async (client) => {
      const upd = await client.query(
        `UPDATE tenants
         SET feature_flags_json = COALESCE(feature_flags_json, '{}'::jsonb) || $2::jsonb,
             updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING id, name, feature_flags_json`,
        [tenantId, JSON.stringify(body?.flags || {})],
      );
      if (upd.rows.length === 0) {
        throw new NotFoundException('Tenant not found.');
      }
      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address, metadata)
         VALUES ($1::uuid, $2, $3, 'FEATURE_FLAGS_UPDATED', 'tenant', $4, $5::uuid, 'Updated tenant feature flags', $6, $7::jsonb)`,
        [user.id, user.email || 'owner@gsign.in', user.role || 'PLATFORM_OWNER', tenantId, tenantId, req.ip || null, JSON.stringify(body?.flags || {})],
      );
      return upd.rows[0];
    });
    return res;
  }

  @UseGuards(AuthGuard, PlatformOwnerGuard)
  @Get('platform/analytics')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Platform-wide usage, subscription, revenue, and trend analytics (Platform Owner only)' })
  async getPlatformAnalytics(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('days') days?: string,
  ) {
    const analytics = this.platformAnalytics ?? new PlatformAnalyticsService(this.db);
    return analytics.getPlatformAnalytics({ from, to, days });
  }

  @Public()
  @Post('contact-sales')
  @ApiOperation({ summary: 'Public enterprise contact sales inquiry submission' })
  async submitContactSales(@Body() dto: CreateSalesInquiryDto, @Req() req: Request) {
    const svc = this.salesInquiries ?? new SalesInquiriesService(this.db, this.redis);
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    return svc.submitPublicInquiry(dto, ip);
  }

  @UseGuards(AuthGuard, PlatformOwnerGuard)
  @Get('platform/sales-inquiries')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List enterprise sales inquiries (Platform Owner only)' })
  async listSalesInquiries(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const svc = this.salesInquiries ?? new SalesInquiriesService(this.db, this.redis);
    return svc.listInquiries({
      page: page ? Number.parseInt(page, 10) : 1,
      limit: limit ? Number.parseInt(limit, 10) : 20,
      status,
      from,
      to,
    });
  }

  @UseGuards(AuthGuard, PlatformOwnerGuard)
  @Get('platform/sales-inquiries/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get enterprise sales inquiry details (Platform Owner only)' })
  async getSalesInquiry(@Param('id') id: string) {
    const svc = this.salesInquiries ?? new SalesInquiriesService(this.db, this.redis);
    return svc.getInquiry(id);
  }

  @UseGuards(AuthGuard, PlatformOwnerGuard)
  @Patch('platform/sales-inquiries/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update enterprise sales inquiry status, assignment, and internal notes (Platform Owner only)' })
  async updateSalesInquiry(
    @Param('id') id: string,
    @Body() dto: UpdateSalesInquiryDto,
    @CurrentUser() user: { id: string; email?: string; role?: string },
    @Req() req: Request,
  ) {
    const svc = this.salesInquiries ?? new SalesInquiriesService(this.db, this.redis);
    return svc.updateInquiry(id, dto, user, req.ip);
  }
}
