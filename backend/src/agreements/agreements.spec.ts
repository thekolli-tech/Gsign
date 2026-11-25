import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { AgreementsService } from './agreements.service';

describe('AgreementsService & RLS Tenant Isolation', () => {
  let db: DatabaseService;
  let agreementsService: AgreementsService;
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
      providers: [AgreementsService],
    }).compile();

    db = module.get<DatabaseService>(DatabaseService);
    agreementsService = module.get<AgreementsService>(AgreementsService);
    await db.onModuleInit();

    const tenantsRes = await db.query(
      `SELECT id, slug FROM tenants WHERE slug IN ('gsign', 'acme') ORDER BY slug ASC`
    );
    const gsign = tenantsRes.rows.find(t => t.slug === 'gsign');
    const acme = tenantsRes.rows.find(t => t.slug === 'acme');
    tenantAId = gsign.id;
    tenantBId = acme.id;

    const uARes = await db.query(`SELECT id, email, full_name FROM users WHERE email = 'priya@gsign.in' LIMIT 1`);
    const uBRes = await db.query(`SELECT id, email, full_name FROM users WHERE email = 'john@acme.com' LIMIT 1`);
    userA = { ...uARes.rows[0], fullName: uARes.rows[0].full_name, role: 'Company Admin' };
    userB = { ...uBRes.rows[0], fullName: uBRes.rows[0].full_name, role: 'Company Admin' };
  });

  it('Creates a Draft agreement, edits it, transitions Draft -> Awaiting signature -> Completed, and rejects invalid transitions', async () => {
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

    const completed = await agreementsService.transitionStatus(tenantAId, userA, draft.id, {
      status: 'Completed',
      signature_data_url: 'data:image/png;base64,TEST',
    });
    expect(completed.status).toBe('Completed');
    expect(completed.auditTrail.length).toBeGreaterThanOrEqual(3);

    // Terminal state transition must fail
    await expect(
      agreementsService.transitionStatus(tenantAId, userA, draft.id, { status: 'Cancelled' })
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
    if (createdIds.length > 0) {
      await db.executeAsSuperAdmin(async client => {
        await client.query(`DELETE FROM agreements WHERE id = ANY($1::uuid[])`, [createdIds]);
      });
    }
    await db.onModuleDestroy();
  });
});
