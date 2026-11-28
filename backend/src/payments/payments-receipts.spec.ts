import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

describe('PaymentsService — Payment Receipts & Acknowledgement (Mocked DB)', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const actor = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'admin@company.in',
    fullName: 'Priya Admin',
    role: 'Company Admin',
  };

  function createServiceWithMockClient(queryImpl: jest.Mock) {
    const db = {
      executeWithTenantContext: jest.fn(async (_tid: string, fn: (client: any) => Promise<any>) =>
        fn({ query: queryImpl }),
      ),
    } as any;
    return { service: new PaymentsService(db), db };
  }

  it('lists tenant-scoped receipts mapped to UI Receipt format', async () => {
    const query = jest.fn().mockResolvedValueOnce({
      rows: [
        {
          id: 'rec-1',
          receipt_number: 'RCT-2026-AABBCC',
          agreement_number: 'AGR-2026-0001',
          payer_name: 'Meera Iyer',
          amount: '30000.00',
          amount_in_words: 'INR 30,000 only',
          payment_mode: 'UPI',
          status: 'Issued',
          tx_reference: 'UPI-123456',
          purpose: 'Advisory retainer',
          acknowledged_by_name: 'Priya Admin',
          acknowledged_at: '2026-11-27T10:00:00.000Z',
          created_at: '2026-11-27T09:00:00.000Z',
          verification_token: 'GSIGN-RCT-112233',
        },
      ],
    });
    const { service, db } = createServiceWithMockClient(query);
    const list = await service.listReceipts(tenantId);

    expect(db.executeWithTenantContext).toHaveBeenCalledWith(tenantId, expect.any(Function));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'RCT-2026-AABBCC',
      uuid: 'rec-1',
      payer: 'Meera Iyer',
      amount: 30000,
      status: 'Issued',
      txRef: 'UPI-123456',
      acknowledgedBy: 'Priya Admin',
      verificationToken: 'GSIGN-RCT-112233',
    });
  });

  it('creates a pending receipt and writes an audit log entry', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'rec-pending-1',
            receipt_number: 'RCT-PENDING-ABC123',
            agreement_number: null,
            agreement_id: null,
            payer_name: 'Acme Client',
            amount: '45000.00',
            amount_in_words: 'INR 45,000 only',
            payment_mode: '—',
            status: 'Payment not confirmed',
            tx_reference: null,
            purpose: 'Retainer',
            acknowledged_by_name: null,
            acknowledged_at: null,
            created_at: '2026-11-27T10:00:00.000Z',
            verification_token: 'GSIGN-RCT-ABCDEF',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const { service } = createServiceWithMockClient(query);
    const created = await service.createReceipt(tenantId, actor, {
      payer_name: 'Acme Client',
      amount: 45000,
      purpose: 'Retainer',
    });

    expect(created.status).toBe('Payment not confirmed');
    expect(created.payer).toBe('Acme Client');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('INSERT INTO audit_logs');
  });

  it('acknowledges a pending receipt, issues an RCT-YYYY number, and logs audit trail', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'rec-pending-1',
            receipt_number: 'RCT-PENDING-ABC123',
            status: 'Payment not confirmed',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'rec-pending-1',
            receipt_number: 'RCT-2026-XYZ789',
            agreement_number: null,
            agreement_id: null,
            payer_name: 'Acme Client',
            amount: '45000.00',
            amount_in_words: 'INR 45,000 only',
            payment_mode: 'UPI',
            status: 'Issued',
            tx_reference: 'UPI-99887766',
            purpose: 'Retainer',
            acknowledged_by_name: 'Priya Admin',
            acknowledged_at: '2026-11-27T10:05:00.000Z',
            created_at: '2026-11-27T10:00:00.000Z',
            verification_token: 'GSIGN-RCT-ABCDEF',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const { service } = createServiceWithMockClient(query);
    const updated = await service.acknowledgeReceipt(tenantId, 'rec-pending-1', actor, {
      payment_mode: 'UPI',
      tx_reference: 'UPI-99887766',
    });

    expect(updated.status).toBe('Issued');
    expect(updated.id).toBe('RCT-2026-XYZ789');
    expect(updated.acknowledgedBy).toBe('Priya Admin');
    expect(query.mock.calls[2][0]).toContain('RECEIPT_ACKNOWLEDGED');
  });

  it('rejects double-acknowledgement with ConflictException and missing receipt with NotFoundException', async () => {
    const alreadyIssuedQuery = jest.fn().mockResolvedValueOnce({
      rows: [{ id: 'rec-1', receipt_number: 'RCT-2026-111111', status: 'Issued' }],
    });
    const { service: s1 } = createServiceWithMockClient(alreadyIssuedQuery);
    await expect(
      s1.acknowledgeReceipt(tenantId, 'rec-1', actor, {
        payment_mode: 'UPI',
        tx_reference: 'UPI-111',
      }),
    ).rejects.toThrow(ConflictException);

    const missingQuery = jest.fn().mockResolvedValueOnce({ rows: [] });
    const { service: s2 } = createServiceWithMockClient(missingQuery);
    await expect(
      s2.acknowledgeReceipt(tenantId, 'missing-id', actor, {
        payment_mode: 'UPI',
        tx_reference: 'UPI-111',
      }),
    ).rejects.toThrow(NotFoundException);

    await expect(
      s2.createReceipt('', actor, { payer_name: 'X', amount: 100, purpose: 'Y' }),
    ).rejects.toThrow(ForbiddenException);
  });
});
