// Not a Base44-ported module — Base44's backend functions ran with the
// caller's TeamMember row and UserPermission overrides already resolved as
// part of the request context. Here we load the same two inputs explicitly
// at the top of each dedicated business-logic route (server/routes/*.js,
// Task #23), so every route works from the same shape instead of five
// slightly-different inline queries.
import { query } from '../db.js';

export async function loadCallerContext(user) {
  const [{ rows: tmRows }, { rows: permRows }] = await Promise.all([
    query('SELECT * FROM team_members WHERE user_id = $1', [user.id]),
    query('SELECT * FROM user_permissions WHERE user_id = $1', [user.id]),
  ]);
  const teamMember = tmRows[0] || null;
  const permissionsRow = permRows[0] || null;
  return {
    teamMember,
    teamMemberRole: teamMember?.role || null,
    permissions: permissionsRow?.permissions || {},
    isDomainAdmin: !!permissionsRow?.is_domain_admin,
  };
}

export async function getLedProjectIds(userId) {
  const { rows } = await query('SELECT id FROM projects WHERE project_leader_id = $1', [userId]);
  return rows.map((r) => r.id);
}
