// Ported from Base44's approvalScope.ts — WITH ONE DELIBERATE BEHAVIOR CHANGE,
// decided explicitly with the studio during migration (see
// studiotime_discovery_notes.md, Discrepancy #1):
//
// The live Base44 app excluded, studio-wide, every entry submitted by anyone
// who holds the project_leader TeamMember role anywhere — even on a project
// the viewing leader manages themselves. (Alice leads Project A; Bob leads
// Project B but also logs ordinary hours as a contributor on Project A; the
// old code hid Bob's Project-A entries from Alice purely because Bob holds
// project_leader somewhere in the studio.)
//
// This rebuild drops that extra exclusion and implements pure per-project
// scoping instead: a project leader sees/approves everything on the
// project(s) they lead, full stop — the entry owner's role elsewhere is
// irrelevant.
import { ADMIN_LEVEL_ROLES } from './roles.js';

// Besides platform admins and ADMIN_LEVEL_ROLES (design_director,
// top_management), design_head also gets studio-wide approval visibility —
// this is specific to approval scope, not the generic tier grouping in
// roles.js (where design_head is a SUPERVISOR_LEVEL_ROLE).
export const BROAD_APPROVAL_ROLES = ['design_head', ...ADMIN_LEVEL_ROLES];

/**
 * @param {object} args
 * @param {string} args.platformRole - user.role ('admin' | 'user')
 * @param {string|null} args.teamMemberRole
 * @param {object} args.permissions - raw UserPermission.permissions JSONB
 * @param {string[]} args.ledProjectIds - ids of projects this user leads
 * @returns {{ viewAll: boolean, projectIds: string[] }}
 *   viewAll=true means no project filter is needed at all (studio-wide).
 *   Otherwise, the caller may see/approve entries whose project_id is in
 *   projectIds, PLUS always their own entries regardless of project.
 */
export function resolveApprovalScope({ platformRole, teamMemberRole, permissions = {}, ledProjectIds = [] } = {}) {
  if (platformRole === 'admin') return { viewAll: true, projectIds: [] };
  if (teamMemberRole && BROAD_APPROVAL_ROLES.includes(teamMemberRole)) return { viewAll: true, projectIds: [] };
  if (permissions?.timesheets?.approve === true) return { viewAll: true, projectIds: [] };
  if (teamMemberRole === 'project_leader') return { viewAll: false, projectIds: [...ledProjectIds] };
  return { viewAll: false, projectIds: [] };
}

// Whether a given timesheet entry is visible/approvable under a resolved
// scope, for one specific caller (own entries are always visible to self).
export function entryInApprovalScope(entry, scope, callerUserId) {
  if (scope.viewAll) return true;
  if (entry.user_id === callerUserId) return true;
  return !!entry.project_id && scope.projectIds.includes(entry.project_id);
}
