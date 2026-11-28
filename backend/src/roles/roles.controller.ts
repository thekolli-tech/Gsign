import { Controller, Get, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentTenant } from '../common/decorators/auth.decorators';

@ApiTags('Roles & Permissions')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @ApiOperation({ summary: 'List roles and associated permission sets' })
  @ApiResponse({ status: 200, description: 'List of roles' })
  async getRoles(@CurrentTenant() tenantId: string | null) {
    let query = `
      SELECT r.id, r.name, r.description, r.is_system_role, r.tenant_id,
             COALESCE(
               json_agg(
                 json_build_object('id', p.id, 'code', p.code, 'category', p.category)
               ) FILTER (WHERE p.id IS NOT NULL), 
               '[]'
             ) as permissions
      FROM roles r
      LEFT JOIN role_permissions rp ON r.id = rp.role_id
      LEFT JOIN permissions p ON rp.permission_id = p.id
    `;

    const params: any[] = [];
    if (tenantId) {
      query += ` WHERE r.is_system_role = true OR r.tenant_id = $1`;
      params.push(tenantId);
    } else {
      query += ` WHERE r.is_system_role = true`;
    }

    query += ` GROUP BY r.id ORDER BY r.is_system_role DESC, r.name ASC;`;

    const res = await this.db.query(query, params);
    return res.rows;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get role details and mapped permissions' })
  @ApiResponse({ status: 200, description: 'Role details' })
  async getRoleById(
    @Param('id') id: string,
    @CurrentTenant() tenantId: string | null,
  ) {
    const params: any[] = [id];
    const scopeClause = tenantId
      ? (() => {
          params.push(tenantId);
          return `(r.is_system_role = true OR r.tenant_id = $2::uuid)`;
        })()
      : `r.is_system_role = true`;

    const res = await this.db.query(
      `SELECT r.id, r.name, r.description, r.is_system_role, r.tenant_id,
              COALESCE(
                json_agg(
                  json_build_object('id', p.id, 'code', p.code, 'category', p.category)
                ) FILTER (WHERE p.id IS NOT NULL),
                '[]'
              ) as permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON r.id = rp.role_id
       LEFT JOIN permissions p ON rp.permission_id = p.id
       WHERE r.id = $1::uuid AND ${scopeClause}
       GROUP BY r.id`,
      params,
    );

    if (res.rows.length === 0) {
      throw new NotFoundException('Role not found');
    }

    return res.rows[0];
  }
}
