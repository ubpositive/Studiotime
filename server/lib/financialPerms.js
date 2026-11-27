// Ported from Base44's financialPerms.ts.
//
// FINANCIAL_FULL_ROLES (+ platform admin) get full financial visibility and
// edit rights everywhere. SETUP_ROLES may edit setup_hours only, but see no
// cost/rate/budget figures at all. Everyone else gets no financial access by
// default. Every area is still overridable per-user via UserPermission.permissions
// (an override, true or false, always wins over the role-based default).
import { PERMISSION_SHAPE } from './roles.js';

export const FINANCIAL_FULL_ROLES = ['top_management'];
export const SETUP_ROLES = ['design_director', 'design_head'];

// Default project-level authority for a resolved tier (see roles.js
// resolveTier). Non-admin tiers get no blanket authority here — their actual
// project access comes from being the project's leader/creator/assigned
// member (checked per-project by the route), widened only by an explicit
// projects.view_all/add/edit/delete permission override.
export function defaultProjectAuthority(tier) {
  if (tier === 'admin') return { view_all: true, add: true, edit: true, delete: true };
  return { view_all: false, add: false, edit: false, delete: false };
}

function mergeFlag(roleDefault, override) {
  return typeof override === 'boolean' ? override : roleDefault;
}

// Resolves the complete financial visibility/edit scope for one caller.
// `permissions` is the raw UserPermission.permissions JSONB (may be partial
// or empty — every area is optional and falls back to the role default).
export function loadFinancialScope({ platformRole, teamMemberRole, permissions = {} } = {}) {
  const isFinancialFull = platformRole === 'admin' || FINANCIAL_FULL_ROLES.includes(teamMemberRole);
  const isSetupRole = !isFinancialFull && SETUP_ROLES.includes(teamMemberRole);

  const p = permissions || {};
  return {
    budget: {
      view: mergeFlag(isFinancialFull, p.budget?.view),
      edit: mergeFlag(isFinancialFull, p.budget?.edit),
    },
    cost_rates: {
      view: mergeFlag(isFinancialFull, p.cost_rates?.view),
      edit: mergeFlag(isFinancialFull, p.cost_rates?.edit),
    },
    actual_cost: {
      view: mergeFlag(isFinancialFull, p.actual_cost?.view),
      edit: mergeFlag(isFinancialFull, p.actual_cost?.edit),
    },
    billed: {
      view: mergeFlag(isFinancialFull, p.billed?.view),
      edit: mergeFlag(isFinancialFull, p.billed?.edit),
    },
    cost_settings: {
      view: mergeFlag(isFinancialFull, p.cost_settings?.view),
      edit: mergeFlag(isFinancialFull, p.cost_settings?.edit),
    },
    setup_hours: {
      edit: mergeFlag(isFinancialFull || isSetupRole, p.setup_hours?.edit),
    },
  };
}

// Used by the roster/team listing to decide whether cost_rate/selling_rate
// may be included in the response at all.
export function canExposeRates(scope) {
  return !!scope?.cost_rates?.view;
}

// Strips fields a project's redactProject() pass should hide for a caller
// without budget/cost_settings visibility: stage_budgets collapses to
// hours-only, and hourly_rate/markup_percentage are removed entirely.
export function redactProject(project, scope) {
  const out = { ...project };
  if (!scope.cost_settings?.view) {
    delete out.hourly_rate;
    delete out.markup_percentage;
  }
  if (!scope.budget?.view && Array.isArray(out.stage_budgets)) {
    out.stage_budgets = out.stage_budgets.map(({ stage, task, budgeted_hours }) => ({ stage, task, budgeted_hours }));
  }
  return out;
}

export { PERMISSION_SHAPE };
