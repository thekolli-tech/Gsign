import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Client } from 'pg';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import {
  cleanupSyntheticFixtures,
  createSyntheticTenantWithAdmin,
  verifySafeIntegrationTarget,
} from '../database/test-db-guard';
import { AgreementsService } from './agreements.service';

describe('AgreementsService & RLS Tenant Isolation', () => {
  let db: DatabaseService;
  let agreementsService: AgreementsService;
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
      providers: [AgreementsService],
    }).compile();

    db = module.get<DatabaseService>(DatabaseService);
    agreementsService = module.get<AgreementsService>(AgreementsService);
    await db.onModuleInit();

    adminClient = new Client({ connectionString: adminDbUrl });
    await adminClient.connect();

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fxA = await createSyntheticTenantWithAdmin(adminClient, runId, 'agr-a');
    const fxB = await createSyntheticTenantWithAdmin(adminClient, runId, 'agr-b');
    tenantAId = fxA.tenantId;
    tenantBId = fxB.tenantId;
    userA = fxA.user;
    userB = fxB.user;
  });

  it('Creates a Draft agreement, edits it, transitions Draft -> Awaiting signature -> Cancelled, and blocks direct Completed transition', async () => {
    const draft = await agreementsService.createAgreement(tenantAId, userA, {
      recipient_name: 'Test Signer',
      recipient_email: 'signer@example.com',
      template_type: 'NDA',
      department: 'Legal',
      fee_amount: 0,
      period: '24 months',
      content: 'Mutual NDA terms.',
      sign_method: 'basic_drawn',
      initial_status: 'Draft',
    });
    createdIds.push(draft.uuid);

    expect(draft.status).toBe('Draft');
    expect(draft.documentHash).toHaveLength(64);
    expect(draft.auditTrail.length).toBe(1);

    const updated = await agreementsService.updateAgreement(tenantAId, userA, draft.id, {
      period: '36 months',
    });
    expect(updated.period).toBe('36 months');

    const sent = await agreementsService.transitionStatus(tenantAId, userA, draft.id, {
      status: 'Awaiting signature',
    });
    expect(sent.status).toBe('Awaiting signature');

    // Editing non-Draft must fail
    await expect(
      agreementsService.updateAgreement(tenantAId, userA, draft.id, { period: '48 months' })
    ).rejects.toThrow(BadRequestException);

    // Direct Completed transition must be blocked until Signing Module authorizes it
    await expect(
      agreementsService.transitionStatus(tenantAId, userA, draft.id, {
        status: 'Completed',
        signature_data_url: 'data:image/png;base64,TEST',
      })
    ).rejects.toThrow(ForbiddenException);

    const cancelled = await agreementsService.transitionStatus(tenantAId, userA, draft.id, {
      status: 'Cancelled',
    });
    expect(cancelled.status).toBe('Cancelled');
    expect(cancelled.auditTrail.length).toBeGreaterThanOrEqual(3);

    // Terminal state transition must fail
    await expect(
      agreementsService.transitionStatus(tenantAId, userA, draft.id, { status: 'Awaiting signature' })
    ).rejects.toThrow(BadRequestException);
  });

  it('Enforces strict cross-tenant RLS isolation between Tenant A and Tenant B', async () => {
    const agA = await agreementsService.createAgreement(tenantAId, userA, {
      recipient_name: 'Isolated Party',
      recipient_email: 'isolated@example.com',
      template_type: 'Offer Letter',
      department: 'HR',
      content: 'Confidential offer.',
      initial_status: 'Draft',
    });
    createdIds.push(agA.uuid);

    const tenantBList = await agreementsService.listAgreements(tenantBId);
    expect(tenantBList.some(a => a.uuid === agA.uuid)).toBe(false);

    await expect(agreementsService.getAgreement(tenantBId, agA.id)).rejects.toThrow(NotFoundException);
    await expect(
      agreementsService.transitionStatus(tenantBId, userB, agA.id, { status: 'Cancelled' })
    ).rejects.toThrow(NotFoundException);
    await expect(agreementsService.deleteDraft(tenantBId, userB, agA.id)).rejects.toThrow(NotFoundException);

    // Tenant A can delete its own Draft
    const delRes = await agreementsService.deleteDraft(tenantAId, userA, agA.id);
    expect(delRes.success).toBe(true);
  });

  afterAll(async () => {
    try {
      await cleanupSyntheticFixtures(adminClient, {
        agreementIds: createdIds,
        tenantIds: [tenantAId, tenantBId],
        userIds: [userA?.id, userB?.id],
      });
    } finally {
      if (adminClient) await adminClient.end().catch(() => {});
      if (db) await db.onModuleDestroy().catch(() => {});
    }
  });
});
