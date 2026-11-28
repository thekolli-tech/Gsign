import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AgreementsService } from '../agreements/agreements.service';
import { SigningService } from './signing.service';

describe('Phase 5B.1: Signing Method Accuracy & Recipient Field Enforcement (Mocked DB/Redis)', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const user = { id: '22222222-2222-4222-8222-222222222222', email: 'admin@acme.in', role: 'Company Admin' };

  it('rejects unintegrated signing methods (aadhaar_esign and dsc) on agreement creation', async () => {
    const dbMock: any = { executeWithTenantContext: jest.fn() };
    const agrSvc = new AgreementsService(dbMock);

    await expect(
      agrSvc.createAgreement(tenantId, user, {
        recipient_name: 'Alok',
        recipient_email: 'alok@example.com',
        template_type: 'NDA',
        department: 'Legal',
        content: 'Agreement terms and conditions...',
        sign_method: 'aadhaar_esign',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      agrSvc.createAgreement(tenantId, user, {
        recipient_name: 'Alok',
        recipient_email: 'alok@example.com',
        template_type: 'NDA',
        department: 'Legal',
        content: 'Agreement terms and conditions...',
        sign_method: 'dsc',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(dbMock.executeWithTenantContext).not.toHaveBeenCalled();
  });

  function makeSigningService(params: {
    agreementStatus: string;
    recipientStatus?: string;
    otpVerifiedAt?: string | null;
  }) {
    const dbMock: any = {
      executeAsSuperAdmin: jest.fn(async (fn: (client: any) => Promise<any>) =>
        fn({
          query: jest.fn().mockResolvedValueOnce({
            rows: [{
              id: 'rec-1',
              tenant_id: tenantId,
              signing_request_id: 'req-1',
              agreement_id: 'agr-1',
              email: 'signer@acme.in',
              status: params.recipientStatus ?? 'PENDING',
              otp_verified_at: params.otpVerifiedAt ?? new Date().toISOString(),
              token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
            }],
          }),
        }),
      ),
      executeWithTenantContext: jest.fn(async (_tid: string, fn: (client: any) => Promise<any>) =>
        fn({
          query: jest.fn(async (sql: string) => {
            if (sql.includes('FROM signing_requests')) {
              return { rows: [{ id: 'req-1', status: 'ACTIVE', sequential: false }] };
            }
            if (sql.includes('FROM agreements')) {
              return {
                rows: [{
                  id: 'agr-1',
                  agreement_number: 'AGR-1',
                  template_type: 'NDA',
                  status: params.agreementStatus,
                  document_hash: 'a'.repeat(64),
                }],
              };
            }
            if (sql.includes('FROM signing_recipients') && sql.includes('signing_request_id = $1::uuid')) {
              return {
                rows: [{
                  id: 'rec-1',
                  signing_order: 1,
                  is_required: true,
                  status: params.recipientStatus ?? 'PENDING',
                }],
              };
            }
            if (sql.includes('FROM signing_recipients')) {
              return {
                rows: [{
                  id: 'rec-1',
                  name: 'Signer',
                  email: 'signer@acme.in',
                  status: params.recipientStatus ?? 'PENDING',
                  otp_verified_at: params.otpVerifiedAt ?? new Date().toISOString(),
                  token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
                }],
              };
            }
            return { rows: [] };
          }),
        }),
      ),
    };
    const redisMock: any = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };
    return new SigningService(dbMock, redisMock, {} as any, {} as any);
  }

  it('rejects recipient attempting to complete a field assigned to another role (Witness/Sender)', async () => {
    const svc = makeSigningService({ agreementStatus: 'Awaiting signature' });
    await expect(
      svc.submitSignature('raw-signing-token-123456', {
        signature_data_url: 'data:image/png;base64,abc',
        consent_accepted: true,
        consent_text: 'I consent',
        field_responses: [
          {
            field_id: 'f-witness',
            type: 'Signature',
            assigned_role: 'Witness',
            required: true,
            value: 'signed',
          },
        ],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects missing required recipient Checkbox, Text, Date, or Initials field responses', async () => {
    const svc1 = makeSigningService({ agreementStatus: 'Awaiting signature' });
    await expect(
      svc1.submitSignature('raw-signing-token-123456', {
        signature_data_url: 'data:image/png;base64,abc',
        consent_accepted: true,
        consent_text: 'I consent',
        field_responses: [
          {
            field_id: 'f-check',
            type: 'Checkbox',
            assigned_role: 'Recipient',
            required: true,
            checked: false,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    const svc2 = makeSigningService({ agreementStatus: 'Awaiting signature' });
    await expect(
      svc2.submitSignature('raw-signing-token-123456', {
        signature_data_url: 'data:image/png;base64,abc',
        consent_accepted: true,
        consent_text: 'I consent',
        field_responses: [
          {
            field_id: 'f-initials',
            type: 'Initials',
            assigned_role: 'Recipient',
            required: true,
            value: '   ',
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects signature submission on terminal agreement states (Completed, Cancelled, Rejected)', async () => {
    const completedSvc = makeSigningService({ agreementStatus: 'Completed', recipientStatus: 'SIGNED' });
    await expect(
      completedSvc.submitSignature('raw-signing-token-123456', {
        signature_data_url: 'data:image/png;base64,abc',
        consent_accepted: true,
        consent_text: 'I consent',
      }),
    ).rejects.toThrow(ConflictException);

    const cancelledSvc = makeSigningService({ agreementStatus: 'Cancelled' });
    await expect(
      cancelledSvc.submitSignature('raw-signing-token-123456', {
        signature_data_url: 'data:image/png;base64,abc',
        consent_accepted: true,
        consent_text: 'I consent',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns Partially signed with next_signer when another required signer is still pending, and blocks OTP_REQUIRED', async () => {
    const dbMock: any = {
      executeAsSuperAdmin: jest.fn(async (fn: (client: any) => Promise<any>) =>
        fn({
          query: jest.fn().mockResolvedValueOnce({
            rows: [{
              id: 'rec-1',
              tenant_id: tenantId,
              signing_request_id: 'req-1',
              agreement_id: 'agr-1',
              email: 'signer1@acme.in',
              status: 'PENDING',
              otp_verified_at: new Date().toISOString(),
              token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
            }],
          }),
        }),
      ),
      executeWithTenantContext: jest.fn(async (_tid: string, fn: (client: any) => Promise<any>) =>
        fn({
          query: jest.fn(async (sql: string) => {
            if (sql.includes('FROM signing_requests')) {
              return { rows: [{ id: 'req-1', status: 'ACTIVE', sequential: true }] };
            }
            if (sql.includes('FROM agreements')) {
              return {
                rows: [{
                  id: 'agr-1',
                  agreement_number: 'AGR-1',
                  template_type: 'NDA',
                  department: 'Legal',
                  recipient_name: 'Signer One',
                  recipient_email: 'signer1@acme.in',
                  status: 'Awaiting signature',
                  document_hash: 'a'.repeat(64),
                }],
              };
            }
            if (sql.includes('FROM signing_recipients') && sql.includes('signing_request_id = $1::uuid') && sql.includes('FOR UPDATE')) {
              return {
                rows: [
                  { id: 'rec-1', signing_order: 1, is_required: true, status: 'PENDING' },
                  { id: 'rec-2', signing_order: 2, is_required: true, status: 'PENDING' },
                ],
              };
            }
            if (sql.includes('FROM signing_recipients') && sql.includes('COUNT(*)')) {
              return { rows: [{ pending_count: 1 }] };
            }
            if (sql.includes('FROM signing_recipients') && sql.includes('LIMIT 1')) {
              return { rows: [{ name: 'Signer Two', email: 'signer2@acme.in', signing_order: 2 }] };
            }
            if (sql.includes('FROM signing_recipients')) {
              return {
                rows: [{
                  id: 'rec-1',
                  name: 'Signer One',
                  email: 'signer1@acme.in',
                  status: 'PENDING',
                  otp_verified_at: new Date().toISOString(),
                  token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
                }],
              };
            }
            return { rows: [] };
          }),
        }),
      ),
    };
    const redisMock: any = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };
    const svc = new SigningService(
      dbMock,
      redisMock,
      undefined,
      { sendNotification: jest.fn().mockResolvedValue({ status: 'sent' }) } as any,
    );
    const res = await svc.submitSignature('raw-signing-token-123456', {
      signature_data_url: 'data:image/png;base64,abc',
      consent_accepted: true,
      consent_text: 'I consent',
    });

    expect(res.signed).toBe(true);
    expect(res.agreement_completed).toBe(false);
    expect(res.agreement_status).toBe('Partially signed');
    expect((res as any).next_signer).toEqual({ name: 'Signer Two', email: 'signer2@acme.in', signing_order: 2 });
  });
});
