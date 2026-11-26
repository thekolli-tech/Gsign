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

  private async ensureTemplatesSchema(client: any) {
    if (this.schemaVerified) return;
    const check = await client.query(
      `SELECT to_regclass('public.templates') IS NOT NULL AS has_tpl,
              to_regclass('public.template_versions') IS NOT NULL AS has_ver`,
    );
    if (!check.rows[0]?.has_tpl || !check.rows[0]?.has_ver) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS templates (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
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
        CREATE INDEX IF NOT EXISTS idx_templates_tenant_id ON templates(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_templates_status ON templates(status);

        CREATE TABLE IF NOT EXISTS template_versions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
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
          OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
        WITH CHECK (
          NULLIF(current_setting('app.is_super_admin', true), '') = 'true'
          OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        );
      `);
    }
    this.schemaVerified = true;
  }

  private mapTemplate(row: any, latestVersion: any, versions: any[] = []) {
    return {
      id: row.id,
      tenantId: row.tenant_id,
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

  async listTemplates(tenantId: string, includeArchived = false) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant context is required.');
    }

    return this.db.executeWithTenantContext(tenantId, async client => {
      await this.ensureTemplatesSchema(client);
      const res = await client.query(
        `SELECT t.*
         FROM templates t
         WHERE t.tenant_id = $1 ${includeArchived ? '' : "AND t.status != 'Archived'"}
         ORDER BY t.updated_at DESC`,
        [tenantId]
      );

      if (res.rows.length === 0) return [];

      const templateIds = res.rows.map(r => r.id);
      const verRes = await client.query(
        `SELECT * FROM template_versions
         WHERE tenant_id = $1 AND template_id = ANY($2::uuid[])
         ORDER BY version_number DESC`,
        [tenantId, templateIds]
      );

      const verMap = new Map<string, any[]>();
      for (const v of verRes.rows) {
        const list = verMap.get(v.template_id) || [];
        list.push(v);
        verMap.set(v.template_id, list);
      }

      return res.rows.map(t => {
        const versions = verMap.get(t.id) || [];
        const latest = versions.find(v => v.version_number === t.current_version) || versions[0];
        return this.mapTemplate(t, latest, versions);
      });
    });
  }

  async getTemplate(tenantId: string, templateId: string) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant context is required.');
    }

    return this.db.executeWithTenantContext(tenantId, async client => {
      await this.ensureTemplatesSchema(client);
      const tRes = await client.query(
        `SELECT * FROM templates WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, templateId]
      );
      if (tRes.rows.length === 0) {
        throw new NotFoundException('Template not found.');
      }

      const verRes = await client.query(
        `SELECT * FROM template_versions
         WHERE tenant_id = $1 AND template_id = $2
         ORDER BY version_number DESC`,
        [tenantId, templateId]
      );

      const tpl = tRes.rows[0];
      const latest = verRes.rows.find(v => v.version_number === tpl.current_version) || verRes.rows[0];
      return this.mapTemplate(tpl, latest, verRes.rows);
    });
  }

  async createTemplate(tenantId: string, user: any, dto: CreateTemplateDto, ip?: string) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant context is required.');
    }

    return this.db.executeWithTenantContext(tenantId, async client => {
      await this.ensureTemplatesSchema(client);
      const tRes = await client.query(
        `INSERT INTO templates (tenant_id, created_by, name, category, department, description, status, current_version)
         VALUES ($1, $2, $3, $4, $5, $6, 'Draft', 1)
         RETURNING *;`,
        [
          tenantId,
          user.id,
          dto.name.trim(),
          (dto.category || 'Offer Letter').trim(),
          (dto.department || 'HR').trim(),
          (dto.description || '').trim(),
        ]
      );
      const tpl = tRes.rows[0];

      const vRes = await client.query(
        `INSERT INTO template_versions (tenant_id, template_id, version_number, status, content, fields_json, created_by)
         VALUES ($1, $2, 1, 'Draft', $3, $4, $5)
         RETURNING *;`,
        [tenantId, tpl.id, dto.content, JSON.stringify(dto.fields || []), user.id]
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1, $2, $3, 'TEMPLATE_CREATED', 'TEMPLATE', $4, $5, $6, $7);`,
        [user.id, user.email, user.role || 'USER', tpl.id, tenantId, `Created template '${tpl.name}' v1`, ip || null]
      );

      return this.mapTemplate(tpl, vRes.rows[0], vRes.rows);
    });
  }

  /**
   * Updates a template. If current_version is already Published, creates a new Draft version
   * rather than overwriting the published version (immutable version history).
   */
  async updateTemplate(tenantId: string, user: any, templateId: string, dto: UpdateTemplateDto, ip?: string) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant context is required.');
    }

    return this.db.executeWithTenantContext(tenantId, async client => {
      await this.ensureTemplatesSchema(client);
      const tRes = await client.query(
        `SELECT * FROM templates WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, templateId]
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
         WHERE tenant_id = $1 AND template_id = $2 AND version_number = $3 LIMIT 1`,
        [tenantId, templateId, tpl.current_version]
      );
      const curVer = curVerRes.rows[0];

      const nextContent = dto.content ?? curVer.content;
      const nextFields = dto.fields !== undefined ? dto.fields : curVer.fields_json;

      let nextVersionNum = tpl.current_version;
      if (curVer.status === 'Published') {
        // Never overwrite a published version — create a new Draft version
        nextVersionNum = tpl.current_version + 1;
        await client.query(
          `INSERT INTO template_versions (tenant_id, template_id, version_number, status, content, fields_json, created_by)
           VALUES ($1, $2, $3, 'Draft', $4, $5, $6);`,
          [tenantId, templateId, nextVersionNum, nextContent, JSON.stringify(nextFields), user.id]
        );
      } else {
        await client.query(
          `UPDATE template_versions
           SET content = $1, fields_json = $2, updated_at = NOW()
           WHERE tenant_id = $3 AND id = $4;`,
          [nextContent, JSON.stringify(nextFields), tenantId, curVer.id]
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
         WHERE tenant_id = $6 AND id = $7
         RETURNING *;`,
        [
          (dto.name || tpl.name).trim(),
          (dto.category || tpl.category).trim(),
          (dto.department || tpl.department).trim(),
          (dto.description ?? tpl.description).trim(),
          nextVersionNum,
          tenantId,
          templateId,
        ]
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1, $2, $3, 'TEMPLATE_UPDATED', 'TEMPLATE', $4, $5, $6, $7);`,
        [user.id, user.email, user.role || 'USER', templateId, tenantId, `Saved draft v${nextVersionNum}`, ip || null]
      );

      const allVers = await client.query(
        `SELECT * FROM template_versions WHERE tenant_id = $1 AND template_id = $2 ORDER BY version_number DESC`,
        [tenantId, templateId]
      );
      const latest = allVers.rows.find(v => v.version_number === nextVersionNum) || allVers.rows[0];
      return this.mapTemplate(updTpl.rows[0], latest, allVers.rows);
    });
  }

  async publishTemplate(tenantId: string, user: any, templateId: string, ip?: string) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant context is required.');
    }

    return this.db.executeWithTenantContext(tenantId, async client => {
      await this.ensureTemplatesSchema(client);
      const tRes = await client.query(
        `SELECT * FROM templates WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, templateId]
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
         WHERE tenant_id = $2 AND template_id = $3 AND version_number = $4;`,
        [user.id, tenantId, templateId, tpl.current_version]
      );

      const updTpl = await client.query(
        `UPDATE templates
         SET status = 'Published', published_version = $1, updated_at = NOW()
         WHERE tenant_id = $2 AND id = $3
         RETURNING *;`,
        [tpl.current_version, tenantId, templateId]
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1, $2, $3, 'TEMPLATE_PUBLISHED', 'TEMPLATE', $4, $5, $6, $7);`,
        [user.id, user.email, user.role || 'USER', templateId, tenantId, `Published template v${tpl.current_version}`, ip || null]
      );

      const allVers = await client.query(
        `SELECT * FROM template_versions WHERE tenant_id = $1 AND template_id = $2 ORDER BY version_number DESC`,
        [tenantId, templateId]
      );
      const latest = allVers.rows.find(v => v.version_number === tpl.current_version) || allVers.rows[0];
      return this.mapTemplate(updTpl.rows[0], latest, allVers.rows);
    });
  }

  async duplicateTemplate(tenantId: string, user: any, templateId: string, ip?: string) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant context is required.');
    }

    return this.db.executeWithTenantContext(tenantId, async client => {
      await this.ensureTemplatesSchema(client);
      const tRes = await client.query(
        `SELECT * FROM templates WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, templateId]
      );
      if (tRes.rows.length === 0) {
        throw new NotFoundException('Template not found.');
      }
      const src = tRes.rows[0];

      const verRes = await client.query(
        `SELECT * FROM template_versions WHERE tenant_id = $1 AND template_id = $2 AND version_number = $3 LIMIT 1`,
        [tenantId, templateId, src.current_version]
      );
      const srcVer = verRes.rows[0];

      const newTpl = await client.query(
        `INSERT INTO templates (tenant_id, created_by, name, category, department, description, status, current_version)
         VALUES ($1, $2, $3, $4, $5, $6, 'Draft', 1)
         RETURNING *;`,
        [tenantId, user.id, `Copy of ${src.name}`, src.category, src.department, src.description]
      );
      const created = newTpl.rows[0];

      const newVer = await client.query(
        `INSERT INTO template_versions (tenant_id, template_id, version_number, status, content, fields_json, created_by)
         VALUES ($1, $2, 1, 'Draft', $3, $4, $5)
         RETURNING *;`,
        [tenantId, created.id, srcVer.content, JSON.stringify(srcVer.fields_json || []), user.id]
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1, $2, $3, 'TEMPLATE_DUPLICATED', 'TEMPLATE', $4, $5, $6, $7);`,
        [user.id, user.email, user.role || 'USER', created.id, tenantId, `Duplicated from ${src.id}`, ip || null]
      );

      return this.mapTemplate(created, newVer.rows[0], newVer.rows);
    });
  }

  async archiveTemplate(tenantId: string, user: any, templateId: string, ip?: string) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant context is required.');
    }

    return this.db.executeWithTenantContext(tenantId, async client => {
      const updRes = await client.query(
        `UPDATE templates SET status = 'Archived', updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *;`,
        [tenantId, templateId]
      );
      if (updRes.rows.length === 0) {
        throw new NotFoundException('Template not found.');
      }

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_email, actor_role, action, target_type, target_id, tenant_id, reason, ip_address)
         VALUES ($1, $2, $3, 'TEMPLATE_ARCHIVED', 'TEMPLATE', $4, $5, $6, $7);`,
        [user.id, user.email, user.role || 'USER', templateId, tenantId, `Archived template '${updRes.rows[0].name}'`, ip || null]
      );

      return { success: true, id: templateId, status: 'Archived' };
    });
  }
}
