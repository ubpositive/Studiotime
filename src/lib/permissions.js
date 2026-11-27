// Client-side mirror of server/lib/roles.js, used only for UI gating (what
// to show/hide/enable) — the API re-checks every one of these server-side,
// so nothing here is a security boundary.

export const DEFAULT_ROLE_VALUES = [
  'junior_designer', 'designer', 'senior_designer', 'bim_modeller', 'cad_technician',
  'project_leader', 'design_head', 'design_director', 'top_management',
];

export const ROLE_RANK = {
  junior_designer: 1, designer: 2, senior_designer: 3, bim_modeller: 2, cad_technician: 2,
  project_leader: 4, design_head: 5, design_director: 6, top_management: 7,
};

export const ROLE_LABELS = {
  junior_designer: 'Junior Designer',
  designer: 'Designer',
  senior_designer: 'Senior Designer',
  bim_modeller: 'BIM Modeller',
  cad_technician: 'CAD Technician',
  project_leader: 'Project Leader',
  design_head: 'Design Head',
  design_director: 'Design Director',
  top_management: 'Top Management',
};

export const SUPERVISOR_LEVEL_ROLES = ['project_leader', 'design_head'];
export const ADMIN_LEVEL_ROLES = ['design_director', 'top_management'];
export const BROAD_APPROVAL_ROLES = ['design_head', ...ADMIN_LEVEL_ROLES];

export function resolveTier({ user, teamMember } = {}) {
  const platformRole = user?.role;
  const teamMemberRole = teamMember?.role;
  if (platformRole === 'admin') return 'admin';
  if (teamMemberRole && ADMIN_LEVEL_ROLES.includes(teamMemberRole)) return 'admin';
  if (teamMemberRole && SUPERVISOR_LEVEL_ROLES.includes(teamMemberRole)) return 'supervisor';
  return 'user';
}

export function isAdmin(user) {
  return !!user && user.role === 'admin';
}

export function isSupervisorOrAbove({ user, teamMember } = {}) {
  return resolveTier({ user, teamMember }) !== 'user';
}

export function canSeeApprovals({ user, teamMember } = {}) {
  if (isAdmin(user)) return true;
  const role = teamMember?.role;
  return !!role && (BROAD_APPROVAL_ROLES.includes(role) || role === 'project_leader');
}

export function canSeePlanning({ user, teamMember } = {}) {
  return isSupervisorOrAbove({ user, teamMember });
}

export function canAssignRole({ actingUser, actingTeamMember, targetUserId, newRole }) {
  if (actingUser?.role === 'admin') return true;
  if (targetUserId === actingUser?.id) return false;
  const actingRank = ROLE_RANK[actingTeamMember?.role] || 0;
  const newRank = ROLE_RANK[newRole] || 0;
  return newRank < actingRank;
}

export function assignableRoles({ actingUser, actingTeamMember }) {
  if (actingUser?.role === 'admin') return DEFAULT_ROLE_VALUES;
  const actingRank = ROLE_RANK[actingTeamMember?.role] || 0;
  return DEFAULT_ROLE_VALUES.filter((r) => ROLE_RANK[r] < actingRank);
}
