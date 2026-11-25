import {
  Controller,
  Get,
  Param,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentTenant, CurrentUser } from '../common/decorators/auth.decorators';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly db: DatabaseService) {}

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
}
