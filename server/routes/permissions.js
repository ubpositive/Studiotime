// Ported from Base44's manageUserPermission, manageAdminDelegation, and
// manageAccountStatus (studiotime_discovery_notes.md §4 #5, #7, #8), plus
// adminResetPassword — which this rebuild replaces entirely with the
// admin-triggered temporary-password mechanism (server/auth.js
// setTemporaryPassword, Task #20/#11) instead of Base44's native
// resetPasswordRequest email flow.
import express from 'express';
import { query } from '../db.js';
import { requireAuth, setTemporaryPassword, findUserById, toPublicUser } from '../auth.js';
import { PERMISSION_SHAPE } from '../lib/roles.js';
import { getAuthority, setAdminDelegation, selfAppointDomainAdmin, canActOnTarget } from '../lib/adminAuthority.js';
import { resetPermissionOverrides } from '../lib/permissionReset.js';

export const permissionsRouter = express.Router();
permissionsRouter.use(requireAuth);

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Not allowed' });
  next();
}

// ---- authority / domain admin / delegation --------------------------------
permissionsRouter.get('/authority', requireAdmin, async (req, res, next) => {
  try { res.json(await getAuthority(req.user)); } catch (err) { next(err); }
});

permissionsRouter.post('/authority/self-appoint', requireAdmin, async (req, res, next) => {
  try {
    res.json(await selfAppointDomainAdmin(req.user));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
});

permissionsRouter.put('/authority/delegation', requireAdmin, async (req, res, next) => {
  try {
    const authority = await getAuthority(req.user);
    if (!authority.is_domain_admin) return res.status(403).json({ message: 'Only the Domain Admin can change delegation' });
    res.json(await setAdminDelegation(req.body || {}, req.user.id));
  } catch (err) { next(err); }
});

// ---- manageUserPermission: get / save (merge-per-area) / set_domain_admin /
// reset_overrides ------------------------------------------------------------
permissionsRouter.get('/users/:userId', requireAdmin, async (req, res, next) => {
  try {
    const authority = await getAuthority(req.user);
    if (!authority.can_view_permissions && !authority.is_domain_admin) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    const { rows } = await query('SELECT * FROM user_permissions WHERE user_id = $1', [req.params.userId]);
    res.json(rows[0] || { user_id: req.params.userId, is_domain_admin: false, permissions: {} });
  } catch (err) { next(err); }
});

permissionsRouter.put('/users/:userId', requireAdmin, async (req, res, next) => {
  try {
    const authority = await getAuthority(req.user);
    if (!authority.can_edit_permissions && !authority.is_domain_admin) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    if (!(await canActOnTarget(req.user, req.params.userId))) {
      return res.status(403).json({ message: 'A regular admin cannot act on a Domain Admin' });
    }
    const { permissions: incoming } = req.body || {};
    if (!incoming || typeof incoming !== 'object') return res.status(400).json({ message: 'permissions object is required' });
    const { rows: existingRows } = await query('SELECT * FROM user_permissions WHERE user_id = $1', [req.params.userId]);
    const current = existingRows[0]?.permissions || {};
    const merged = { ...current };
    for (const area of Object.keys(PERMISSION_SHAPE)) {
      if (incoming[area]) merged[area] = { ...(current[area] || {}), ...incoming[area] };
    }
    const { rows } = await query(
      `INSERT INTO user_permissions (user_id, permissions, updated_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET permissions = $2, updated_by = $3, updated_at = now()
       RETURNING *`,
      [req.params.userId, JSON.stringify(merged), req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

permissionsRouter.post('/users/:userId/set-domain-admin', requireAdmin, async (req, res, next) => {
  try {
    const authority = await getAuthority(req.user);
    if (!authority.is_domain_admin) return res.status(403).json({ message: 'Only the Domain Admin can transfer this' });
    const { is_domain_admin } = req.body || {};
    const { rows } = await query(
      `INSERT INTO user_permissions (user_id, is_domain_admin, updated_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET is_domain_admin = $2, updated_by = $3, updated_at = now()
       RETURNING *`,
      [req.params.userId, !!is_domain_admin, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

permissionsRouter.post('/users/:userId/reset-overrides', requireAdmin, async (req, res, next) => {
  try {
    const authority = await getAuthority(req.user);
    if (!authority.can_edit_permissions && !authority.is_domain_admin) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    res.json(await resetPermissionOverrides(req.params.userId, req.user.id));
  } catch (err) { next(err); }
});

// ---- adminResetPassword -> temporary-password mechanism --------------------
permissionsRouter.post('/users/:userId/reset-password', requireAdmin, async (req, res, next) => {
  try {
    const authority = await getAuthority(req.user);
    if (!authority.can_reset_passwords && !authority.is_domain_admin) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    if (!(await canActOnTarget(req.user, req.params.userId))) {
      return res.status(403).json({ message: "A regular admin cannot reset a Domain Admin's password" });
    }
    const target = await findUserById(req.params.userId);
    if (!target) return res.status(404).json({ message: 'Not found' });
    const { tempPassword } = await setTemporaryPassword(req.params.userId);
    res.json({ tempPassword });
  } catch (err) { next(err); }
});

// ---- manageAccountStatus ----------------------------------------------------
const MIN_REASON_LENGTH = 5;

permissionsRouter.post('/users/:userId/disable', requireAdmin, async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    if (!reason || reason.trim().length < MIN_REASON_LENGTH) {
      return res.status(400).json({ message: `A reason of at least ${MIN_REASON_LENGTH} characters is required` });
    }
    if (!(await canActOnTarget(req.user, req.params.userId))) {
      return res.status(403).json({ message: 'A regular admin cannot act on a Domain Admin' });
    }
    const target = await findUserById(req.params.userId);
    if (!target) return res.status(404).json({ message: 'Not found' });
    const { rows } = await query(
      `UPDATE users SET account_status = 'disabled', disabled_at = now(), disabled_reason = $1, updated_date = now()
       WHERE id = $2 RETURNING *`,
      [reason.trim(), req.params.userId]
    );
    await query(
      `INSERT INTO account_status_audit (target_user_id, target_name, target_email, action, reason, performed_by_id, performed_by_email, performed_at)
       VALUES ($1,$2,$3,'disabled',$4,$5,$6,now())`,
      [req.params.userId, target.full_name, target.email, reason.trim(), req.user.id, req.user.email]
    );
    res.json(toPublicUser(rows[0]));
  } catch (err) { next(err); }
});

permissionsRouter.post('/users/:userId/reenable', requireAdmin, async (req, res, next) => {
  try {
    const { reason, confirmations } = req.body || {};
    if (!reason || reason.trim().length < MIN_REASON_LENGTH) {
      return res.status(400).json({ message: `A reason of at least ${MIN_REASON_LENGTH} characters is required` });
    }
    if (!confirmations || confirmations < 2) {
      return res.status(400).json({ message: 'Re-enabling requires two confirmations' });
    }
    if (!(await canActOnTarget(req.user, req.params.userId))) {
      return res.status(403).json({ message: 'A regular admin cannot act on a Domain Admin' });
    }
    const target = await findUserById(req.params.userId);
    if (!target) return res.status(404).json({ message: 'Not found' });
    const { rows } = await query(
      `UPDATE users SET account_status = 'active', reenabled_at = now(), updated_date = now()
       WHERE id = $1 RETURNING *`,
      [req.params.userId]
    );
    await query(
      `INSERT INTO account_status_audit (target_user_id, target_name, target_email, action, reason, performed_by_id, performed_by_email, performed_at)
       VALUES ($1,$2,$3,'reenabled',$4,$5,$6,now())`,
      [req.params.userId, target.full_name, target.email, reason.trim(), req.user.id, req.user.email]
    );
    res.json(toPublicUser(rows[0]));
  } catch (err) { next(err); }
});
