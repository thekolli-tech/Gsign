import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Client } from 'pg';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import {
  cleanupSyntheticFixtures,
  createSyntheticTenantWithAdmin,
  verifySafeIntegrationTarget,
} from '../database/test-db-guard';
import { TemplatesService } from './templates.service';

describe('TemplatesService Versioning & RLS Isolation', () => {
  let db: DatabaseService;
  let templatesService: TemplatesService;
  let adminClient: Client | null = null;
  let tenantAId: string;
  let tenantBId: string;
  let userA: any;
  let userB: any;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const { adminDbUrl } = await verifySafeIntegrationTarget();

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

    adminClient = new Client({ connectionString: adminDbUrl });
    await adminClient.connect();

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fxA = await createSyntheticTenantWithAdmin(adminClient, runId, 'tpl-a');
    const fxB = await createSyntheticTenantWithAdmin(adminClient, runId, 'tpl-b');
    tenantAId = fxA.tenantId;
    tenantBId = fxB.tenantId;
    userA = fxA.user;
    userB = fxB.user;
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
    try {
      await cleanupSyntheticFixtures(adminClient, {
        templateIds: createdIds,
        tenantIds: [tenantAId, tenantBId],
        userIds: [userA?.id, userB?.id],
      });
    } finally {
      if (adminClient) await adminClient.end().catch(() => {});
      if (db) await db.onModuleDestroy().catch(() => {});
    }
  });
});
