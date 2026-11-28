import { BadRequestException, HttpException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '../common/guards/auth.guard';
import { PlatformOwnerGuard } from '../common/guards/platform-owner.guard';
import { IS_PUBLIC_KEY } from '../common/decorators/auth.decorators';
import { CreateSalesInquiryDto } from './dto/sales-inquiry.dto';
import { SalesInquiriesService } from './sales-inquiries.service';
import { TenantsController } from './tenants.controller';

describe('SalesInquiriesService & Public/Platform Owner Endpoints (Mocked DB & Redis)', () => {
  function createService(opts?: { queryImpl?: jest.Mock; incrResult?: number }) {
    const query = opts?.queryImpl ?? jest.fn().mockResolvedValue({ rows: [] });
    const db = {
      executeAsSuperAdmin: jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query })),
    } as any;
    const redis = {
      incr: jest.fn().mockResolvedValue(opts?.incrResult ?? 1),
      expire: jest.fn().mockResolvedValue(1),
    } as any;
    return { service: new SalesInquiriesService(db, redis), db, query, redis };
  }

  it('validates public CreateSalesInquiryDto (rejects bad email, invalid phone, missing fields)', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    await expect(
      pipe.transform(
        {
          contact_name: 'Sumanth',
          company_name: 'Acme',
          business_email: 'not-an-email',
          phone_number: 'invalid-phone-!@#',
          company_size: '11-50',
        },
        { type: 'body', metatype: CreateSalesInquiryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('normalizes email, persists inquiry, and hides internal notes/IDs in public response', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // no duplicate
      .mockResolvedValueOnce({ rows: [] }); // insert
    const { service } = createService({ queryImpl: query });

    const res = await service.submitPublicInquiry(
      {
        contact_name: ' Sumanth Rao ',
        company_name: ' Global Logistics ',
        business_email: ' SUMANTH@Enterprise.COM ',
        phone_number: '+91 98765 43210',
        company_size: '51-250',
        requested_plan: 'Enterprise',
        message: 'Need custom SLA',
      },
      '203.0.113.10',
    );

    expect(res.success).toBe(true);
    expect(res).not.toHaveProperty('internal_notes');
    expect(res).not.toHaveProperty('id');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1][2]).toBe('sumanth@enterprise.com');
  });

  it('suppresses duplicate submissions within 15 minutes without creating duplicate rows', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [{ id: 'existing-1' }] });
    const { service } = createService({ queryImpl: query });

    const res = await service.submitPublicInquiry(
      {
        contact_name: 'Sumanth Rao',
        company_name: 'Global Logistics',
        business_email: 'sumanth@enterprise.com',
        company_size: '51-250',
      },
      '203.0.113.10',
    );

    expect(res.success).toBe(true);
    expect(query).toHaveBeenCalledTimes(1); // Only duplicate check, no INSERT
  });

  it('enforces Redis rate limiting on public inquiry submissions', async () => {
    const { service } = createService({ incrResult: 6 });
    await expect(
      service.submitPublicInquiry(
        {
          contact_name: 'Spam',
          company_name: 'Bot Co',
          business_email: 'bot@spam.test',
          company_size: '1-10',
        },
        '198.51.100.5',
      ),
    ).rejects.toThrow(HttpException);
  });

  it('enforces @Public on contact-sales and AuthGuard + PlatformOwnerGuard on Platform Owner routes', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, TenantsController.prototype.submitContactSales)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, TenantsController.prototype.listSalesInquiries)).toEqual([
      AuthGuard,
      PlatformOwnerGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, TenantsController.prototype.getSalesInquiry)).toEqual([
      AuthGuard,
      PlatformOwnerGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, TenantsController.prototype.updateSalesInquiry)).toEqual([
      AuthGuard,
      PlatformOwnerGuard,
    ]);
  });

  it('supports pagination and status/date filtering and rejects invalid filters', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'inq-1',
            contact_name: 'Sumanth',
            company_name: 'Global Logistics',
            business_email: 'sumanth@enterprise.com',
            status: 'qualified',
            internal_notes: 'Confidential call notes',
          },
        ],
      });
    const { service } = createService({ queryImpl: query });

    const result = await service.listInquiries({
      page: 2,
      limit: 10,
      status: 'qualified',
      from: '2026-11-01',
      to: '2026-11-27',
    });

    expect(result.total).toBe(1);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
    expect(query.mock.calls[0][0]).toContain('WHERE status = $1 AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz');

    await expect(service.listInquiries({ status: 'invalid_status' })).rejects.toThrow(BadRequestException);
    await expect(service.listInquiries({ from: 'bad-date' })).rejects.toThrow(BadRequestException);
  });

  it('updates status, assignment, internal notes and records an audit log entry', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'inq-1', status: 'new', assigned_to_email: null }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'inq-1',
            status: 'qualified',
            assigned_to_email: 'owner@genemax.in',
            internal_notes: 'Enterprise SLA quoted',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const { service } = createService({ queryImpl: query });
    const updated = await service.updateInquiry(
      'inq-1',
      {
        status: 'qualified',
        assigned_to_email: 'OWNER@genemax.in',
        internal_notes: 'Enterprise SLA quoted',
      },
      { id: 'owner-1', email: 'owner@gsign.in', role: 'PLATFORM_OWNER' },
      '127.0.0.1',
    );

    expect(updated.status).toBe('qualified');
    expect(updated.assigned_to_email).toBe('owner@genemax.in');
    expect(query.mock.calls[2][0]).toContain('SALES_INQUIRY_UPDATED');

    const missingQuery = jest.fn().mockResolvedValueOnce({ rows: [] });
    const { service: s2 } = createService({ queryImpl: missingQuery });
    await expect(
      s2.updateInquiry('missing-id', { status: 'closed' }, { id: 'owner-1' }),
    ).rejects.toThrow(NotFoundException);
  });
});
