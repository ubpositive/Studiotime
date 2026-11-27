// Ported from Base44's planningAccess.ts — used by the resource-planning
// endpoints (listResourcePlan, reassignMembers, resolveAssignmentConflict,
// stageCapacity).
import { resolveTier } from './roles.js';

/**
 * @returns {{ canViewTeam: boolean, viewAllProjects: boolean }}
 *   canViewTeam: may see the full roster (not just themselves) in the planner.
 *   viewAllProjects: may see every project's allocations, not just projects
 *   they lead/created/are assigned to.
 */
export function resolvePlanningAccess({ platformRole, teamMemberRole, permissions = {} } = {}) {
  const tier = resolveTier({ platformRole, teamMemberRole });
  const canViewTeam = tier !== 'user' || permissions?.resource_planning?.view_team === true;
  const viewAllProjects = tier === 'admin' || permissions?.resource_planning?.view_all === true;
  return { canViewTeam, viewAllProjects };
}

// A project is "in scope" for a user if they lead it, created it, or are
// currently an assigned member — used to scope resource-planning endpoints
// to projects a non-privileged caller may actually open.
export function projectInScope(project, userId) {
  if (!project || !userId) return false;
  if (project.project_leader_id === userId) return true;
  if (project.created_by_id === userId) return true;
  const assigned = Array.isArray(project.assigned_members) ? project.assigned_members : [];
  return assigned.includes(userId);
}
