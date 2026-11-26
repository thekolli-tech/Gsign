import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { TemplatesService } from './templates.service';

describe('TemplatesService Versioning & RLS Isolation', () => {
  let db: DatabaseService;
  let templatesService: TemplatesService;
  let tenantAId: string;
  let tenantBId: string;
  let userA: any;
  let userB: any;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env', '../.env'],
        }),
        DatabaseModule,
      ],
      providers: [TemplatesService],
    }).compile();

    db = module.get<DatabaseService>(DatabaseService);
    templatesService = module.get<TemplatesService>(TemplatesService);
    await db.onModuleInit();

    const tenantsRes = await db.query(
      `SELECT id, slug FROM tenants WHERE slug IN ('gsign', 'acme') ORDER BY slug ASC`
    );
    tenantAId = tenantsRes.rows.find(t => t.slug === 'gsign').id;
    tenantBId = tenantsRes.rows.find(t => t.slug === 'acme').id;

    const uARes = await db.query(`SELECT id, email, full_name FROM users WHERE email = 'priya@gsign.in' LIMIT 1`);
    const uBRes = await db.query(`SELECT id, email, full_name FROM users WHERE email = 'john@acme.com' LIMIT 1`);
    userA = { ...uARes.rows[0], fullName: uARes.rows[0].full_name, role: 'Company Admin' };
    userB = { ...uBRes.rows[0], fullName: uBRes.rows[0].full_name, role: 'Company Admin' };
  });

  it('Creates, updates, publishes, creates new version on edit, duplicates, and archives templates', async () => {
    const created = await templatesService.createTemplate(tenantAId, userA, {
      name: 'Offer Letter Template',
      category: 'Offer Letter',
      department: 'HR',
      content: 'Offer to {{recipient_name}}',
      fields: [{ id: 'f1', type: 'Signature', label: 'Recipient signature', required: true }],
    });
    createdIds.push(created.id);

    expect(created.status).toBe('Draft');
    expect(created.currentVersion).toBe(1);

    const published = await templatesService.publishTemplate(tenantAId, userA, created.id);
    expect(published.status).toBe('Published');
    expect(published.publishedVersion).toBe(1);

    // Editing a Published template must create v2 Draft without overwriting v1 Published
    const v2Draft = await templatesService.updateTemplate(tenantAId, userA, created.id, {
      content: 'Updated offer to {{recipient_name}}',
    });
    expect(v2Draft.currentVersion).toBe(2);
    expect(v2Draft.versionStatus).toBe('Draft');
    expect(v2Draft.versions.length).toBe(2);
    expect(v2Draft.versions.find((v: any) => v.versionNumber === 1)?.status).toBe('Published');

    const dup = await templatesService.duplicateTemplate(tenantAId, userA, created.id);
    createdIds.push(dup.id);
    expect(dup.name).toBe('Copy of Offer Letter Template');
    expect(dup.currentVersion).toBe(1);
    expect(dup.status).toBe('Draft');

    const archived = await templatesService.archiveTemplate(tenantAId, userA, dup.id);
    expect(archived.status).toBe('Archived');

    // Editing an Archived template must fail
    await expect(
      templatesService.updateTemplate(tenantAId, userA, dup.id, { name: 'Should fail' })
    ).rejects.toThrow(BadRequestException);
  });

  it('Enforces strict cross-tenant RLS isolation on templates and versions', async () => {
    const tplA = await templatesService.createTemplate(tenantAId, userA, {
      name: 'Private NDA',
      content: 'Confidential NDA',
    });
    createdIds.push(tplA.id);

    const tenantBList = await templatesService.listTemplates(tenantBId, true);
    expect(tenantBList.some(t => t.id === tplA.id)).toBe(false);

    await expect(templatesService.getTemplate(tenantBId, tplA.id)).rejects.toThrow(NotFoundException);
    await expect(
      templatesService.updateTemplate(tenantBId, userB, tplA.id, { name: 'Hijack' })
    ).rejects.toThrow(NotFoundException);
    await expect(templatesService.publishTemplate(tenantBId, userB, tplA.id)).rejects.toThrow(NotFoundException);
    await expect(templatesService.duplicateTemplate(tenantBId, userB, tplA.id)).rejects.toThrow(NotFoundException);
    await expect(templatesService.archiveTemplate(tenantBId, userB, tplA.id)).rejects.toThrow(NotFoundException);
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await db.executeAsSuperAdmin(async client => {
        await client.query(`DELETE FROM templates WHERE id = ANY($1::uuid[])`, [createdIds]);
      });
    }
    await db.onModuleDestroy();
  });
});
