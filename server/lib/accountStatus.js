// Ported from Base44's accountStatus.ts. Deliberately tiny: the actual
// disable/re-enable workflow (manageAccountStatus, with its MIN_REASON_LENGTH
// and audit trail) lives in server/routes/permissions.js (Task #23); this
// module is just the shared predicate + message every other route uses to
// gate on a disabled target account.

export const DISABLED_ACCOUNT_ERROR = 'This account has been disabled. Contact an administrator.';

export function isAccountDisabled(user) {
  return !!user && user.account_status === 'disabled';
}
