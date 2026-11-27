// Ported from Base44's adminAuthority.ts.
//
// Domain Admin is an app-level flag (user_permissions.is_domain_admin) sitting
// above the platform's built-in 'admin' role, only ever held by accounts that
// are also platform admins. Three delegated switches — view_permissions,
// edit_permissions, reset_passwords — live in one app_settings record keyed
// 'admin_delegation', controlling whether *regular* (non-domain-admin) admins
// may view/edit permissions or reset passwords. A Domain Admin always has all
// three. Before any Domain Admin exists, any platform admin may self-appoint
// (bootstrap) so the mechanism can never lock everyone out.
import { query } from '../db.js';

const DELEGATION_KEY = 'admin_delegation';
const DEFAULT_DELEGATION = { view_permissions: false, edit_permissions: false, reset_passwords: false };

export async function getAdminDelegation() {
  const { rows } = await query('SELECT value FROM app_settings WHERE key = $1', [DELEGATION_KEY]);
  if (!rows[0]) return { ...DEFAULT_DELEGATION };
  return { ...DEFAULT_DELEGATION, ...rows[0].value };
}

export async function setAdminDelegation(flags, updatedByUserId) {
  const current = await getAdminDelegation();
  const merged = {
    view_permissions: typeof flags.view_permissions === 'boolean' ? flags.view_permissions : current.view_permissions,
    edit_permissions: typeof flags.edit_permissions === 'boolean' ? flags.edit_permissions : current.edit_permissions,
    reset_passwords: typeof flags.reset_passwords === 'boolean' ? flags.reset_passwords : current.reset_passwords,
  };
  await query(
    `INSERT INTO app_settings (key, value, created_by_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_date = now()`,
    [DELEGATION_KEY, JSON.stringify(merged), updatedByUserId]
  );
  return merged;
}

export async function isDomainAdmin(userId) {
  const { rows } = await query('SELECT is_domain_admin FROM user_permissions WHERE user_id = $1', [userId]);
  return !!rows[0]?.is_domain_admin;
}

export async function anyDomainAdminExists() {
  const { rows } = await query('SELECT 1 FROM user_permissions WHERE is_domain_admin = true LIMIT 1');
  return rows.length > 0;
}

// Full authority object for a given (already-authenticated) user. Non-admins
// get every flag false — authority is an admin-only concept.
export async function getAuthority(user) {
  if (!user || user.role !== 'admin') {
    return { is_domain_admin: false, can_view_permissions: false, can_edit_permissions: false, can_reset_passwords: false };
  }
  const domainAdmin = await isDomainAdmin(user.id);
  if (domainAdmin) {
    return { is_domain_admin: true, can_view_permissions: true, can_edit_permissions: true, can_reset_passwords: true };
  }
  const delegation = await getAdminDelegation();
  return {
    is_domain_admin: false,
    can_view_permissions: !!delegation.view_permissions,
    can_edit_permissions: !!delegation.edit_permissions,
    can_reset_passwords: !!delegation.reset_passwords,
  };
}

// Bootstrap self-appointment: only a platform admin, and only while no
// Domain Admin exists yet anywhere in the system.
export async function selfAppointDomainAdmin(user) {
  if (!user || user.role !== 'admin') {
    const err = new Error('Only an admin may self-appoint as Domain Admin');
    err.status = 403;
    throw err;
  }
  if (await anyDomainAdminExists()) {
    const err = new Error('A Domain Admin already exists');
    err.status = 409;
    throw err;
  }
  await query(
    `INSERT INTO user_permissions (user_id, is_domain_admin, updated_by)
     VALUES ($1, true, $1)
     ON CONFLICT (user_id) DO UPDATE SET is_domain_admin = true, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [user.id]
  );
  return getAuthority(user);
}

// A regular (non-domain-admin) admin can never act on a Domain Admin's
// account, even with reset_passwords/edit_permissions delegated to them.
export async function canActOnTarget(actingUser, targetUserId) {
  if (actingUser.role !== 'admin') return false;
  const actingIsDomainAdmin = await isDomainAdmin(actingUser.id);
  if (actingIsDomainAdmin) return true;
  const targetIsDomainAdmin = await isDomainAdmin(targetUserId);
  return !targetIsDomainAdmin;
}
