// Shared role/permission constants, ported verbatim (as data) from Base44's
// manageTeamMember / manageUserPermission. This file has no Base44 file
// precedent of its own — the original app repeated these constants inline in
// nearly every shared module; consolidating them here avoids five copies of
// the same arrays without changing any behavior.

export const DEFAULT_ROLE_VALUES = [
  'junior_designer', 'designer', 'senior_designer', 'bim_modeller', 'cad_technician',
  'project_leader', 'design_head', 'design_director', 'top_management',
];

export const ROLE_RANK = {
  junior_designer: 1,
  designer: 2,
  senior_designer: 3,
  bim_modeller: 2,
  cad_technician: 2,
  project_leader: 4,
  design_head: 5,
  design_director: 6,
  top_management: 7,
};

export const SUPERVISOR_LEVEL_ROLES = ['project_leader', 'design_head'];
export const ADMIN_LEVEL_ROLES = ['design_director', 'top_management'];

// The authoritative, complete list of every granular permission flag in the
// app (manageUserPermission's PERMISSION_SHAPE). Used both to validate
// incoming permission-override payloads and as the shape merged into.
export const PERMISSION_SHAPE = {
  projects: ['view_all', 'add', 'edit', 'delete'],
  project_members: ['add', 'edit', 'delete'],
  timesheets: ['approve', 'edit_approved'],
  resource_planning: ['view_team', 'view_all'],
  team: ['view', 'add', 'edit', 'delete'],
  budget: ['view', 'edit'],
  cost_rates: ['view', 'edit'],
  actual_cost: ['view', 'edit'],
  billed: ['view', 'edit'],
  cost_settings: ['view', 'edit'],
  setup_hours: ['edit'],
};

// A caller's "tier" is resolved from the platform-level user.role plus their
// TeamMember role, if any. This pattern repeats across nearly every shared
// module in the original app.
export function resolveTier({ platformRole, teamMemberRole } = {}) {
  if (platformRole === 'admin') return 'admin';
  if (teamMemberRole && ADMIN_LEVEL_ROLES.includes(teamMemberRole)) return 'admin';
  if (teamMemberRole && SUPERVISOR_LEVEL_ROLES.includes(teamMemberRole)) return 'supervisor';
  return 'user';
}

export function isSupervisorRole(role) {
  return SUPERVISOR_LEVEL_ROLES.includes(role);
}

export function isAdminLevelRole(role) {
  return ADMIN_LEVEL_ROLES.includes(role);
}

// A non-platform-admin may only assign/change a TeamMember role strictly
// below their own highest rank, and may never change their own role.
export function canAssignRole({ actingPlatformRole, actingTeamMemberRole, targetUserId, actingUserId, newRole }) {
  if (actingPlatformRole === 'admin') return true;
  if (targetUserId === actingUserId) return false;
  const actingRank = ROLE_RANK[actingTeamMemberRole] || 0;
  const newRank = ROLE_RANK[newRole] || 0;
  return newRank < actingRank;
}
