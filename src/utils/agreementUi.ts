import type { AgreementStatus } from '../types';

const TERMINAL_OR_NON_SIGNABLE_STATUSES: ReadonlySet<string> = new Set([
  'Completed',
  'Cancelled',
  'Rejected',
  'Expired',
]);

export function canSignAgreementStatus(status: AgreementStatus | string): boolean {
  return !TERMINAL_OR_NON_SIGNABLE_STATUSES.has(status);
}

export function isRootAdminRole(role: string | null | undefined): boolean {
  return role === 'platform_owner' || role === 'super_admin' || role === 'PLATFORM_OWNER';
}
