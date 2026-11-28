import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { DatabaseService } from '../database/database.service';
import { SessionService } from '../auth/session.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { SubscriptionGuard } from '../common/guards/subscription.guard';
import { CurrentTenant, CurrentUser, Permissions } from '../common/decorators/auth.decorators';

class UpdateMemberStatusDto {
  @IsString()
  @IsIn(['Active', 'Deactivated'])
  status!: 'Active' | 'Deactivated';
}

class UpdateMemberRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  role_name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  department?: string;
}

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(AuthGuard, SubscriptionGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly db: DatabaseService,
    private readonly sessionService: SessionService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List team members in active tenant or all users for root admin' })
  @ApiResponse({ status: 200, description: 'List of users' })
  async getUsers(
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: any
  ) {
    if (tenantId) {
      // Execute within tenant context enforcing PostgreSQL RLS on tenant_memberships
      return this.db.executeWithTenantContext(tenantId, async (client) => {
        const res = await client.query(
          `SELECT u.id, u.email, u.full_name, u.phone_number, u.is_active,
                  tm.department, tm.status as membership_status, tm.created_at as joined_at,
                  r.name as role_name
           FROM tenant_memberships tm
           JOIN users u ON tm.user_id = u.id
           JOIN roles r ON tm.role_id = r.id
           WHERE tm.tenant_id = $1
           ORDER BY tm.created_at ASC`,
          [tenantId]
        );
        return res.rows;
      });
    }

    if (user.isSuperAdmin) {
      const res = await this.db.query(
        `SELECT id, email, full_name, phone_number, is_super_admin, is_active, created_at
         FROM users
         ORDER BY created_at DESC`
      );
      return res.rows;
    }

    return [];
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user details by ID' })
  @ApiResponse({ status: 200, description: 'User details' })
  async getUserById(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() user: any
  ) {
    if (tenantId) {
      const res = await this.db.executeWithTenantContext(tenantId, async (client) => {
        return client.query(
          `SELECT u.id, u.email, u.full_name, u.phone_number, u.is_active,
                  tm.department, tm.status as membership_status,
                  r.name as role_name
           FROM tenant_memberships tm
           JOIN users u ON tm.user_id = u.id
           JOIN roles r ON tm.role_id = r.id
           WHERE tm.tenant_id = $1 AND u.id = $2`,
          [tenantId, id]
        );
      });

      if (res.rows.length === 0) {
        throw new NotFoundException('User not found in current organization');
      }
      return res.rows[0];
    }

    if (user.isSuperAdmin) {
      const res = await this.db.query(
        `SELECT id, email, full_name, phone_number, is_super_admin, is_active, created_at
         FROM users WHERE id = $1`,
        [id]
      );
      if (res.rows.length === 0) {
        throw new NotFoundException('User not found');
      }
      return res.rows[0];
    }

    throw new NotFoundException('User not found');
  }

  @UseGuards(PermissionsGuard)
  @Permissions('team:manage')
  @Patch(':id/status')
  @ApiOperation({ summary: 'Activate or deactivate a tenant member and revoke active sessions' })
  async updateMemberStatus(
    @Param('id') targetUserId: string,
    @Body() dto: UpdateMemberStatusDto,
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() actor: any,
    @Req() req: Request,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Active tenant workspace context is required.');
    }
    if (actor?.id && actor.id === targetUserId) {
      throw new ForbiddenException('Administrators cannot deactivate or reactivate their own account.');
    }

    const nextMembershipStatus = dto.status === 'Active' ? 'Active' : 'Inactive';
    const result = await this.db.executeWithTenantContext(tenantId, async (client) => {
      // Lock tenant row to serialize concurrent last-Company-Admin checks
      await client.query(`SELECT id FROM tenants WHERE id = $1::uuid FOR UPDATE`, [tenantId]);

      const targetRes = await client.query(
        `SELECT tm.id AS membership_id, tm.status AS membership_status, tm.role_id,
                r.name AS role_name, u.id AS user_id, u.email, u.full_name,
                u.is_super_admin, u.is_platform_owner
         FROM tenant_memberships tm
         JOIN users u ON u.id = tm.user_id
         JOIN roles r ON r.id = tm.role_id
         WHERE tm.tenant_id = $1::uuid AND tm.user_id = $2::uuid
         FOR UPDATE`,
        [tenantId, targetUserId],
      );

      if (targetRes.rows.length === 0) {
        throw new NotFoundException('Member not found in the current workspace.');
      }

      const target = targetRes.rows[0];
      if (target.is_super_admin || target.is_platform_owner) {
        throw new ForbiddenException('Cannot modify platform administrator status.');
      }

      if (nextMembershipStatus !== 'Active' && target.role_name === 'Company Admin' && target.membership_status === 'Active') {
        const adminCountRes = await client.query(
          `SELECT COUNT(*)::int AS cnt
           FROM tenant_memberships
           WHERE tenant_id = $1::uuid AND role_id = $2::uuid AND status = 'Active' AND user_id <> $3::uuid`,
          [tenantId, target.role_id, targetUserId],
        );
        if (adminCountRes.rows[0].cnt === 0) {
          throw new BadRequestException(
            'Cannot deactivate the last active Company Admin in the workspace.',
          );
        }
      }

      if (nextMembershipStatus === 'Active' && target.membership_status !== 'Active' && !actor?.isPlatformOwner) {
        const subRes = await client.query(
          `SELECT sp.name AS plan_name, sp.max_users
           FROM tenant_subscriptions ts
           JOIN subscription_plans sp ON sp.id = ts.plan_id
           WHERE ts.tenant_id = $1::uuid
             AND (
               (UPPER(ts.status) IN ('ACTIVE', 'TRIALING') AND (ts.current_period_end IS NULL OR ts.current_period_end >= NOW() OR (ts.grace_period_end IS NOT NULL AND ts.grace_period_end > NOW())))
               OR (UPPER(ts.status) = 'PAST_DUE' AND ts.grace_period_end IS NOT NULL AND ts.grace_period_end > NOW())
             )
           ORDER BY ts.updated_at DESC NULLS LAST, ts.created_at DESC
           LIMIT 1`,
          [tenantId],
        );
        const activeSub = subRes.rows[0];
        if (!activeSub) {
          throw new ForbiddenException('An active subscription plan is required to reactivate members.');
        }
        const maxUsers = Number(activeSub.max_users);
        if (maxUsers !== -1) {
          const seatRes = await client.query(
            `SELECT
               (SELECT COUNT(*)::int FROM tenant_memberships WHERE tenant_id = $1::uuid AND status = 'Active' AND user_id <> $2::uuid) AS active_users,
               (SELECT COUNT(*)::int FROM invitations WHERE tenant_id = $1::uuid AND accepted_at IS NULL AND expires_at > NOW()) AS pending_invites`,
            [tenantId, targetUserId],
          );
          const usedSeats = Number(seatRes.rows[0]?.active_users ?? 0) + Number(seatRes.rows[0]?.pending_invites ?? 0);
          if (usedSeats >= maxUsers) {
            throw new ForbiddenException(
              `Seat limit (${maxUsers}) reached for the ${activeSub.plan_name} plan. Please upgrade your subscription or deactivate another member first.`,
            );
          }
        }
      }

      await client.query(
        `UPDATE tenant_memberships
         SET status = $1, updated_at = NOW()
         WHERE id = $2::uuid`,
        [nextMembershipStatus, target.membership_id],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address, metadata)
         VALUES ($1::uuid, $2, $3, 'TEAM_MEMBER_STATUS_UPDATED', 'USER', $4, $5::uuid, $6, $7, $8::jsonb)`,
        [
          actor.id,
          actor.email || 'admin',
          actor.role || 'Company Admin',
          targetUserId,
          tenantId,
          `Member status changed from ${target.membership_status} to ${nextMembershipStatus}`,
          req.ip || null,
          JSON.stringify({
            before_status: target.membership_status,
            after_status: nextMembershipStatus,
          }),
        ],
      );

      return {
        id: target.user_id,
        email: target.email,
        full_name: target.full_name,
        membership_status: nextMembershipStatus,
        status: nextMembershipStatus === 'Active' ? 'Active' : 'Deactivated',
      };
    });

    let revokedSessions = 0;
    if (nextMembershipStatus !== 'Active') {
      revokedSessions = await this.sessionService.revokeUserTenantSessions(targetUserId, tenantId);
    }

    return {
      success: true,
      id: result.id,
      email: result.email,
      full_name: result.full_name,
      membership_status: result.membership_status,
      status: result.status,
      revoked_sessions: revokedSessions,
    };
  }

  @UseGuards(PermissionsGuard)
  @Permissions('team:manage')
  @Patch(':id/role')
  @ApiOperation({ summary: 'Update a tenant member role and department' })
  async updateMemberRole(
    @Param('id') targetUserId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentTenant() tenantId: string | null,
    @CurrentUser() actor: any,
    @Req() req: Request,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Active tenant workspace context is required.');
    }
    if (actor?.id && actor.id === targetUserId) {
      throw new ForbiddenException('Administrators cannot modify their own workspace role.');
    }

    const requestedRoleName = dto.role_name.trim();
    if (requestedRoleName === 'PLATFORM_OWNER' || requestedRoleName === 'Super Admin') {
      throw new ForbiddenException(
        'Company administrators cannot assign platform administration privileges.',
      );
    }

    const roleRes = await this.db.query(
      `SELECT id, name FROM roles
       WHERE name = $1 AND (is_system_role = true OR tenant_id = $2::uuid)
       LIMIT 1`,
      [requestedRoleName, tenantId],
    );
    if (roleRes.rows.length === 0) {
      throw new BadRequestException(`Role '${requestedRoleName}' is not available for this workspace.`);
    }
    const nextRole = roleRes.rows[0];

    const updated = await this.db.executeWithTenantContext(tenantId, async (client) => {
      // Lock tenant row to serialize concurrent last-Company-Admin checks
      await client.query(`SELECT id FROM tenants WHERE id = $1::uuid FOR UPDATE`, [tenantId]);

      const targetRes = await client.query(
        `SELECT tm.id AS membership_id, tm.status AS membership_status, tm.role_id, tm.department,
                r.name AS role_name, u.id AS user_id, u.email, u.full_name,
                u.is_super_admin, u.is_platform_owner
         FROM tenant_memberships tm
         JOIN users u ON u.id = tm.user_id
         JOIN roles r ON r.id = tm.role_id
         WHERE tm.tenant_id = $1::uuid AND tm.user_id = $2::uuid
         FOR UPDATE`,
        [tenantId, targetUserId],
      );

      if (targetRes.rows.length === 0) {
        throw new NotFoundException('Member not found in the current workspace.');
      }

      const target = targetRes.rows[0];
      if (target.is_super_admin || target.is_platform_owner) {
        throw new ForbiddenException('Cannot modify platform administrator role.');
      }

      if (
        target.role_name === 'Company Admin' &&
        nextRole.name !== 'Company Admin' &&
        target.membership_status === 'Active'
      ) {
        const adminCountRes = await client.query(
          `SELECT COUNT(*)::int AS cnt
           FROM tenant_memberships
           WHERE tenant_id = $1::uuid AND role_id = $2::uuid AND status = 'Active' AND user_id <> $3::uuid`,
          [tenantId, target.role_id, targetUserId],
        );
        if (adminCountRes.rows[0].cnt === 0) {
          throw new BadRequestException(
            'Cannot demote the last active Company Admin in the workspace.',
          );
        }
      }

      const nextDepartment = dto.department?.trim() || target.department || 'General';

      await client.query(
        `UPDATE tenant_memberships
         SET role_id = $1::uuid, department = $2, updated_at = NOW()
         WHERE id = $3::uuid`,
        [nextRole.id, nextDepartment, target.membership_id],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address, metadata)
         VALUES ($1::uuid, $2, $3, 'TEAM_MEMBER_ROLE_UPDATED', 'USER', $4, $5::uuid, $6, $7, $8::jsonb)`,
        [
          actor.id,
          actor.email || 'admin',
          actor.role || 'Company Admin',
          targetUserId,
          tenantId,
          `Role updated from '${target.role_name}' to '${nextRole.name}'`,
          req.ip || null,
          JSON.stringify({
            before_role: target.role_name,
            after_role: nextRole.name,
            before_department: target.department,
            after_department: nextDepartment,
          }),
        ],
      );

      return {
        id: target.user_id,
        email: target.email,
        full_name: target.full_name,
        role_name: nextRole.name,
        department: nextDepartment,
      };
    });

    // Immediately invalidate target user's cached Redis + PG sessions in this tenant
    const revokedSessions = await this.sessionService.revokeUserTenantSessions(targetUserId, tenantId);

    return {
      success: true,
      id: updated.id,
      email: updated.email,
      full_name: updated.full_name,
      role_name: updated.role_name,
      department: updated.department,
      revoked_sessions: revokedSessions,
    };
  }
}
