// Ported from Base44's permissionReset.ts — the 'reset_overrides' action of
// manageUserPermission (server/routes/permissions.js, Task #23). Clears a
// user's granular permission overrides back to empty, so every area falls
// back to its role-based default (see financialPerms.js / planningAccess.js /
// approvalScope.js), without touching is_domain_admin.
import { query } from '../db.js';

export async function resetPermissionOverrides(userId, updatedByUserId) {
  const { rows } = await query(
    `INSERT INTO user_permissions (user_id, permissions, updated_by)
     VALUES ($1, '{}'::jsonb, $2)
     ON CONFLICT (user_id) DO UPDATE SET permissions = '{}'::jsonb, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [userId, updatedByUserId]
  );
  return rows[0];
}
