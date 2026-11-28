import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canSignAgreementStatus, isRootAdminRole } from './agreementUi.ts';

describe('Agreement UI & Role Routing Helpers', () => {
  it('allows signing action only for active non-terminal agreement statuses', () => {
    assert.equal(canSignAgreementStatus('Draft'), true);
    assert.equal(canSignAgreementStatus('Awaiting OTP'), true);
    assert.equal(canSignAgreementStatus('Awaiting signature'), true);
    assert.equal(canSignAgreementStatus('Partially signed'), true);
    assert.equal(canSignAgreementStatus('Completed'), false);
    assert.equal(canSignAgreementStatus('Cancelled'), false);
    assert.equal(canSignAgreementStatus('Rejected'), false);
    assert.equal(canSignAgreementStatus('Expired'), false);
  });

  it('identifies root admin roles accurately for dashboard routing', () => {
    assert.equal(isRootAdminRole('platform_owner'), true);
    assert.equal(isRootAdminRole('super_admin'), true);
    assert.equal(isRootAdminRole('PLATFORM_OWNER'), true);
    assert.equal(isRootAdminRole('company_admin'), false);
    assert.equal(isRootAdminRole('company_staff'), false);
    assert.equal(isRootAdminRole(null), false);
  });
});
