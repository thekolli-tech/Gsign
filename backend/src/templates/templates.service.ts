import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';

@Injectable()
export class TemplatesService {
  private schemaVerified = false;

  constructor(private readonly db: DatabaseService) {}

  private isSuperAdminUser(user: any): boolean {
    return Boolean(
      user?.isSuperAdmin ||
        user?.isPlatformOwner ||
        user?.role === 'PLATFORM_OWNER' ||
        user?.role === 'SUPER_ADMIN',
    );
  }

  private async ensureTemplatesSchema(client: any) {
    if (this.schemaVerified) return;
    await client.query(`
      CREATE TABLE IF NOT EXISTS templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        is_global BOOLEAN NOT NULL DEFAULT TRUE,
        created_by UUID NOT NULL REFERENCES users(id),
        name VARCHAR(128) NOT NULL,
        category VARCHAR(64) NOT NULL DEFAULT 'Offer Letter',
        department VARCHAR(64) NOT NULL DEFAULT 'HR',
        description TEXT NOT NULL DEFAULT '',
        status VARCHAR(32) NOT NULL DEFAULT 'Draft',
        current_version INTEGER NOT NULL DEFAULT 1,
        published_version INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE templates ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE templates ALTER COLUMN tenant_id DROP NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_templates_tenant_id ON templates(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_templates_status ON templates(status);

      CREATE TABLE IF NOT EXISTS template_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        template_id UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'Draft',
        content TEXT NOT NULL,
        fields_json JSONB NOT NULL DEFAULT '[]',
        created_by UUID NOT NULL REFERENCES users(id),
        published_by UUID REFERENCES users(id),
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_template_version UNIQUE (template_id, version_number)
      );
      ALTER TABLE template_versions ALTER COLUMN tenant_id DROP NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_template_versions_tenant_id ON template_versions(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_template_versions_template_id ON template_versions(template_id);

      ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
      ALTER TABLE templates FORCE ROW LEVEL SECURITY;
      ALTER TABLE template_versions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE template_versions FORCE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS tenant_isolation_templates ON templates;
      CREATE POLICY tenant_isolation_templates ON templates
      FOR ALL
      USING (
        NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
        OR is_global = true
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
      )
      WITH CHECK (
        NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
      );

      DROP POLICY IF EXISTS tenant_isolation_template_versions ON template_versions;
      CREATE POLICY tenant_isolation_template_versions ON template_versions
      FOR ALL
      USING (
        NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
        OR EXISTS (
          SELECT 1 FROM templates t
          WHERE t.id = template_versions.template_id AND t.is_global = true
        )
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
      )
      WITH CHECK (
        NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
      );
    `);
    this.schemaVerified = true;
  }

  private mapTemplate(row: any, latestVersion: any, versions: any[] = []) {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      isGlobal: Boolean(row.is_global),
      createdBy: row.created_by,
      name: row.name,
      category: row.category,
      department: row.department,
      description: row.description,
      status: row.status,
      currentVersion: row.current_version,
      publishedVersion: row.published_version,
      content: latestVersion?.content || '',
      fields: Array.isArray(latestVersion?.fields_json) ? latestVersion.fields_json : [],
      versionStatus: latestVersion?.status || row.status,
      versions: versions.map(v => ({
        id: v.id,
        versionNumber: v.version_number,
        status: v.status,
        publishedAt: v.published_at,
        createdAt: v.created_at,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listTemplates(tenantId: string | null, includeArchived = false, user?: any) {
    const isAdmin = this.isSuperAdminUser(user);
    if (!isAdmin && !tenantId) {
      throw new ForbiddenException('Tenant context is required.');
    }

    const runner = isAdmin
      ? <T>(cb: (client: any) => Promise<T>) => this.db.executeAsSuperAdmin(cb)
      : <T>(cb: (client: any) => Promise<T>) => this.db.executeWithTenantContext(tenantId!, cb);

    return runner(async client => {
      await this.ensureTemplatesSchema(client);
      const res = isAdmin
        ? await client.query(
            `SELECT t.*
             FROM templates t
             WHERE ${includeArchived ? 'TRUE' : "t.status != 'Archived'"}
             ORDER BY t.updated_at DESC`,
          )
        : await client.query(
            `SELECT t.*
             FROM templates t
             WHERE ((t.is_global = true AND t.status = 'Published') OR t.tenant_id = $1::uuid)
               ${includeArchived ? '' : "AND t.status != 'Archived'"}
             ORDER BY t.updated_at DESC`,
            [tenantId],
          );

      if (res.rows.length === 0) return [];

      const templateIds = res.rows.map(r => r.id);
      const verRes = await client.query(
        `SELECT * FROM template_versions
         WHERE template_id = ANY($1::uuid[])
         ORDER BY version_number DESC`,
        [templateIds],
      );

      const verMap = new Map<string, any[]>();
      for (const v of verRes.rows) {
        const list = verMap.get(v.template_id) || [];
        list.push(v);
        verMap.set(v.template_id, list);
      }

      return res.rows.map(t => {
        const versions = verMap.get(t.id) || [];
        const targetVerNum = !isAdmin && t.published_version ? t.published_version : t.current_version;
        const latest = versions.find(v => v.version_number === targetVerNum) || versions[0];
        return this.mapTemplate(t, latest, versions);
      });
    });
  }

  async getTemplate(tenantId: string | null, templateId: string, user?: any) {
    const isAdmin = this.isSuperAdminUser(user);
    if (!isAdmin && !tenantId) {
      throw new ForbiddenException('Tenant context is required.');
    }

    const runner = isAdmin
      ? <T>(cb: (client: any) => Promise<T>) => this.db.executeAsSuperAdmin(cb)
      : <T>(cb: (client: any) => Promise<T>) => this.db.executeWithTenantContext(tenantId!, cb);

    return runner(async client => {
      await this.ensureTemplatesSchema(client);
      const tRes = isAdmin
        ? await client.query(`SELECT * FROM templates WHERE id = $1::uuid LIMIT 1`, [templateId])
        : await client.query(
            `SELECT * FROM templates
             WHERE id = $1::uuid
               AND ((is_global = true AND status = 'Published') OR tenant_id = $2::uuid)
             LIMIT 1`,
            [templateId, tenantId],
          );
      if (tRes.rows.length === 0) {
        throw new NotFoundException('Template not found.');
      }

      const verRes = await client.query(
        `SELECT * FROM template_versions
         WHERE template_id = $1::uuid
         ORDER BY version_number DESC`,
        [templateId],
      );

      const tpl = tRes.rows[0];
      const targetVerNum = !isAdmin && tpl.published_version ? tpl.published_version : tpl.current_version;
      const latest = verRes.rows.find(v => v.version_number === targetVerNum) || verRes.rows[0];
      return this.mapTemplate(tpl, latest, verRes.rows);
    });
  }

  async createTemplate(tenantId: string | null, user: any, dto: CreateTemplateDto, ip?: string) {
    if (!this.isSuperAdminUser(user)) {
      throw new ForbiddenException('Only Super Admin can create GSIGN templates.');
    }

    return this.db.executeAsSuperAdmin(async client => {
      await this.ensureTemplatesSchema(client);
      const tRes = await client.query(
        `INSERT INTO templates (tenant_id, is_global, created_by, name, category, department, description, status, current_version)
         VALUES ($1, true, $2, $3, $4, $5, $6, 'Draft', 1)
         RETURNING *;`,
        [
          tenantId || null,
          user.id,
          dto.name.trim(),
          (dto.category || 'Offer Letter').trim(),
          (dto.department || 'HR').trim(),
          (dto.description || '').trim(),
        ],
      );
      const tpl = tRes.rows[0];

      const vRes = await client.query(
        `INSERT INTO template_versions (tenant_id, template_id, version_number, status, content, fields_json, created_by)
         VALUES ($1, $2, 1, 'Draft', $3, $4, $5)
         RETURNING *;`,
        [tenantId || null, tpl.id, dto.content, JSON.stringify(dto.fields || []), user.id],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1, $2, $3, 'TEMPLATE_CREATED', 'TEMPLATE', $4, $5, $6, $7);`,
        [user.id, user.email, user.role || 'PLATFORM_OWNER', tpl.id, tenantId || null, `Created global template '${tpl.name}' v1`, ip || null],
      );

      return this.mapTemplate(tpl, vRes.rows[0], vRes.rows);
    });
  }

  /**
   * Updates a global template (Super Admin only). If current_version is already Published,
   * creates a new Draft version rather than overwriting the published version.
   */
  async updateTemplate(tenantId: string | null, user: any, templateId: string, dto: UpdateTemplateDto, ip?: string) {
    if (!this.isSuperAdminUser(user)) {
      throw new ForbiddenException('Only Super Admin can edit GSIGN templates.');
    }

    return this.db.executeAsSuperAdmin(async client => {
      await this.ensureTemplatesSchema(client);
      const tRes = await client.query(
        `SELECT * FROM templates WHERE id = $1::uuid LIMIT 1`,
        [templateId],
      );
      if (tRes.rows.length === 0) {
        throw new NotFoundException('Template not found.');
      }
      const tpl = tRes.rows[0];
      if (tpl.status === 'Archived') {
        throw new BadRequestException('Archived templates cannot be edited. Duplicate it first.');
      }

      const curVerRes = await client.query(
        `SELECT * FROM template_versions
         WHERE template_id = $1::uuid AND version_number = $2 LIMIT 1`,
        [templateId, tpl.current_version],
      );
      const curVer = curVerRes.rows[0];

      const nextContent = dto.content ?? curVer.content;
      const nextFields = dto.fields !== undefined ? dto.fields : curVer.fields_json;

      let nextVersionNum = tpl.current_version;
      if (curVer.status === 'Published') {
        nextVersionNum = tpl.current_version + 1;
        await client.query(
          `INSERT INTO template_versions (tenant_id, template_id, version_number, status, content, fields_json, created_by)
           VALUES ($1, $2, $3, 'Draft', $4, $5, $6);`,
          [tpl.tenant_id || tenantId || null, templateId, nextVersionNum, nextContent, JSON.stringify(nextFields), user.id],
        );
      } else {
        await client.query(
          `UPDATE template_versions
           SET content = $1, fields_json = $2, updated_at = NOW()
           WHERE id = $3::uuid;`,
          [nextContent, JSON.stringify(nextFields), curVer.id],
        );
      }

      const updTpl = await client.query(
        `UPDATE templates
         SET name = $1,
             category = $2,
             department = $3,
             description = $4,
             current_version = $5,
             status = CASE WHEN status = 'Published' AND $5 > COALESCE(published_version, 0) THEN 'Draft' ELSE status END,
             updated_at = NOW()
         WHERE id = $6::uuid
         RETURNING *;`,
        [
          (dto.name || tpl.name).trim(),
          (dto.category || tpl.category).trim(),
          (dto.department || tpl.department).trim(),
          (dto.description ?? tpl.description).trim(),
          nextVersionNum,
          templateId,
        ],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1, $2, $3, 'TEMPLATE_UPDATED', 'TEMPLATE', $4, $5, $6, $7);`,
        [user.id, user.email, user.role || 'PLATFORM_OWNER', templateId, tpl.tenant_id || tenantId || null, `Saved draft v${nextVersionNum}`, ip || null],
      );

      const allVers = await client.query(
        `SELECT * FROM template_versions WHERE template_id = $1::uuid ORDER BY version_number DESC`,
        [templateId],
      );
      const latest = allVers.rows.find(v => v.version_number === nextVersionNum) || allVers.rows[0];
      return this.mapTemplate(updTpl.rows[0], latest, allVers.rows);
    });
  }

  async publishTemplate(tenantId: string | null, user: any, templateId: string, ip?: string) {
    if (!this.isSuperAdminUser(user)) {
      throw new ForbiddenException('Only Super Admin can publish GSIGN templates.');
    }

    return this.db.executeAsSuperAdmin(async client => {
      await this.ensureTemplatesSchema(client);
      const tRes = await client.query(
        `SELECT * FROM templates WHERE id = $1::uuid LIMIT 1`,
        [templateId],
      );
      if (tRes.rows.length === 0) {
        throw new NotFoundException('Template not found.');
      }
      const tpl = tRes.rows[0];
      if (tpl.status === 'Archived') {
        throw new BadRequestException('Archived templates cannot be published.');
      }

      await client.query(
        `UPDATE template_versions
         SET status = 'Published', published_by = $1, published_at = NOW(), updated_at = NOW()
         WHERE template_id = $2::uuid AND version_number = $3;`,
        [user.id, templateId, tpl.current_version],
      );

      const updTpl = await client.query(
        `UPDATE templates
         SET status = 'Published', is_global = true, published_version = $1, updated_at = NOW()
         WHERE id = $2::uuid
         RETURNING *;`,
        [tpl.current_version, templateId],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1, $2, $3, 'TEMPLATE_PUBLISHED', 'TEMPLATE', $4, $5, $6, $7);`,
        [user.id, user.email, user.role || 'PLATFORM_OWNER', templateId, tpl.tenant_id || tenantId || null, `Published global template v${tpl.current_version}`, ip || null],
      );

      const allVers = await client.query(
        `SELECT * FROM template_versions WHERE template_id = $1::uuid ORDER BY version_number DESC`,
        [templateId],
      );
      const latest = allVers.rows.find(v => v.version_number === tpl.current_version) || allVers.rows[0];
      return this.mapTemplate(updTpl.rows[0], latest, allVers.rows);
    });
  }

  async duplicateTemplate(tenantId: string | null, user: any, templateId: string, ip?: string) {
    if (!this.isSuperAdminUser(user)) {
      throw new ForbiddenException('Only Super Admin can duplicate GSIGN templates.');
    }

    return this.db.executeAsSuperAdmin(async client => {
      await this.ensureTemplatesSchema(client);
      const tRes = await client.query(
        `SELECT * FROM templates WHERE id = $1::uuid LIMIT 1`,
        [templateId],
      );
      if (tRes.rows.length === 0) {
        throw new NotFoundException('Template not found.');
      }
      const src = tRes.rows[0];

      const verRes = await client.query(
        `SELECT * FROM template_versions WHERE template_id = $1::uuid AND version_number = $2 LIMIT 1`,
        [templateId, src.current_version],
      );
      const srcVer = verRes.rows[0];

      const newTpl = await client.query(
        `INSERT INTO templates (tenant_id, is_global, created_by, name, category, department, description, status, current_version)
         VALUES ($1, true, $2, $3, $4, $5, $6, 'Draft', 1)
         RETURNING *;`,
        [src.tenant_id || tenantId || null, user.id, `Copy of ${src.name}`, src.category, src.department, src.description],
      );
      const created = newTpl.rows[0];

      const newVer = await client.query(
        `INSERT INTO template_versions (tenant_id, template_id, version_number, status, content, fields_json, created_by)
         VALUES ($1, $2, 1, 'Draft', $3, $4, $5)
         RETURNING *;`,
        [src.tenant_id || tenantId || null, created.id, srcVer.content, JSON.stringify(srcVer.fields_json || []), user.id],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1, $2, $3, 'TEMPLATE_DUPLICATED', 'TEMPLATE', $4, $5, $6, $7);`,
        [user.id, user.email, user.role || 'PLATFORM_OWNER', created.id, src.tenant_id || tenantId || null, `Duplicated from ${src.id}`, ip || null],
      );

      return this.mapTemplate(created, newVer.rows[0], newVer.rows);
    });
  }

  async archiveTemplate(tenantId: string | null, user: any, templateId: string, ip?: string) {
    if (!this.isSuperAdminUser(user)) {
      throw new ForbiddenException('Only Super Admin can archive GSIGN templates.');
    }

    return this.db.executeAsSuperAdmin(async client => {
      await this.ensureTemplatesSchema(client);
      const updRes = await client.query(
        `UPDATE templates SET status = 'Archived', updated_at = NOW()
         WHERE id = $1::uuid
         RETURNING *;`,
        [templateId],
      );
      if (updRes.rows.length === 0) {
        throw new NotFoundException('Template not found.');
      }

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1, $2, $3, 'TEMPLATE_ARCHIVED', 'TEMPLATE', $4, $5, $6, $7);`,
        [user.id, user.email, user.role || 'PLATFORM_OWNER', templateId, updRes.rows[0].tenant_id || tenantId || null, `Archived template '${updRes.rows[0].name}'`, ip || null],
      );

      return { success: true, id: templateId, status: 'Archived' };
    });
  }
}
