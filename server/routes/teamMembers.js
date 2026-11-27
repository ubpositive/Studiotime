// Ported from Base44's manageTeamMember, plus listRoster and listUsers
// (studiotime_discovery_notes.md §4 #2, #14, #15).
//
// manageTeamMember: create/update/delete, with rate-change self-protection
// (a non-admin/non-supervisor editing their own record can never change
// their own rates or role) and role-change rank gating (server/lib/roles.js
// — a caller may only assign/change a role strictly below their own
// highest rank, and never their own).
//
// listRoster is exported as listRosterCore so server/routes/approvals.js can
// reuse the exact same visibility logic for the Approvals-page feed
// (for_approval:true) instead of duplicating it.
import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { resolveTier, canAssignRole, isAdminLevelRole } from '../lib/roles.js';
import { loadCallerContext } from '../lib/callerContext.js';
import { loadFinancialScope, canExposeRates } from '../lib/financialPerms.js';
import { resolveApprovalScope, entryInApprovalScope } from '../lib/approvalScope.js';

export const teamMembersRouter = express.Router();
teamMembersRouter.use(requireAuth);

// ---- listRoster (core) ----------------------------------------------------
// Roster (rates stripped unless canExposeRates, email stripped unless
// team.view/admin/supervisor+), timesheet entries filtered to own + led/
// created/assigned projects (or all for admin/view_all). forApproval:true
// further narrows the entries to resolveApprovalScope() for the Approvals
// page. Never returns anything beyond what the caller's financial scope
// allows.
export async function listRosterCore(req, { forApproval = false } = {}) {
  const ctx = await loadCallerContext(req.user);
  const tier = resolveTier({ platformRole: req.user.role, teamMemberRole: ctx.teamMemberRole });
  const finScope = loadFinancialScope({ platformRole: req.user.role, teamMemberRole: ctx.teamMemberRole, permissions: ctx.permissions });
  const exposeRates = canExposeRates(finScope);
  const exposeEmail = tier !== 'user' || ctx.permissions?.team?.view === true;

  const { rows: members } = await query('SELECT * FROM team_members ORDER BY name ASC');
  const roster = members.map((m) => {
    const out = {
      id: m.id, user_id: m.user_id, name: m.name, role: m.role, location: m.location,
      holiday_calendar: m.holiday_calendar, max_hours_day: m.max_hours_day, max_hours_week: m.max_hours_week,
      max_hours_month: m.max_hours_month, max_overtime_hours_week: m.max_overtime_hours_week,
    };
    if (exposeEmail) out.email = m.email;
    if (exposeRates) { out.cost_rate = m.cost_rate; out.selling_rate = m.selling_rate; out.currency = m.currency; }
    return out;
  });

  const { rows: allProjects } = await query('SELECT id, name, project_leader_id, created_by_id, assigned_members FROM projects');

  // For the approval feed, resolve approval scope FIRST — a BROAD_APPROVAL_ROLE
  // (design_head/design_director/top_management) or a timesheets.approve
  // override gets viewAll:true there even though they don't lead/create/get
  // assigned to every project, and that studio-wide visibility must widen the
  // project pre-filter below, not just the final entry filter — otherwise an
  // entry on a project the approver doesn't otherwise have standing on gets
  // dropped before resolveApprovalScope ever sees it.
  let approvalScope = null;
  if (forApproval) {
    const ledProjectIds = allProjects.filter((p) => p.project_leader_id === req.user.id).map((p) => p.id);
    approvalScope = resolveApprovalScope({
      platformRole: req.user.role, teamMemberRole: ctx.teamMemberRole, permissions: ctx.permissions, ledProjectIds,
    });
  }

  const viewAllProjects = req.user.role === 'admin' || ctx.permissions?.projects?.view_all === true || approvalScope?.viewAll === true;
  const visibleProjects = viewAllProjects ? allProjects : allProjects.filter((p) => {
    const assigned = Array.isArray(p.assigned_members) ? p.assigned_members : [];
    return p.project_leader_id === req.user.id || p.created_by_id === req.user.id || assigned.includes(req.user.id);
  });
  const visibleProjectIds = new Set(visibleProjects.map((p) => p.id));

  const { rows: entries } = await query(`SELECT * FROM timesheet_entries WHERE entry_type = 'work' ORDER BY date DESC`);
  let scopedEntries = entries.filter((e) => (e.project_id && visibleProjectIds.has(e.project_id)) || e.user_id === req.user.id);

  if (forApproval) {
    scopedEntries = scopedEntries.filter((e) => entryInApprovalScope(e, approvalScope, req.user.id));
  }

  return {
    roster,
    projects: visibleProjects.map((p) => ({ id: p.id, name: p.name })),
    timesheet_entries: scopedEntries,
  };
}

teamMembersRouter.get('/roster', async (req, res, next) => {
  try {
    res.json(await listRosterCore(req, { forApproval: false }));
  } catch (err) { next(err); }
});

// listUsers: admin-level TeamMember roles (design_director/top_management)
// or platform admins get full User records; supervisors (project_leader/
// design_head) get a name-only subset; plain users get nothing.
teamMembersRouter.get('/users', async (req, res, next) => {
  try {
    const ctx = await loadCallerContext(req.user);
    const tier = resolveTier({ platformRole: req.user.role, teamMemberRole: ctx.teamMemberRole });
    if (tier === 'user') return res.status(403).json({ message: 'Not allowed' });
    const { rows } = await query('SELECT * FROM users ORDER BY created_date ASC');
    if (req.user.role === 'admin' || isAdminLevelRole(ctx.teamMemberRole)) {
      return res.json(rows.map((u) => ({
        id: u.id, email: u.email, full_name: u.full_name, role: u.role, approved: u.approved,
        account_status: u.account_status, created_date: u.created_date,
      })));
    }
    res.json(rows.map((u) => ({ id: u.id, full_name: u.full_name })));
  } catch (err) { next(err); }
});

// manageTeamMember — create. Callable by anyone above 'user' tier; the
// specific role being granted is still gated by canAssignRole below.
teamMembersRouter.post('/', async (req, res, next) => {
  try {
    const ctx = await loadCallerContext(req.user);
    const tier = resolveTier({ platformRole: req.user.role, teamMemberRole: ctx.teamMemberRole });
    if (tier === 'user') return res.status(403).json({ message: 'Not allowed' });
    const {
      user_id, name, email, cost_rate, selling_rate, currency, role, location, holiday_calendar,
      max_hours_day, max_hours_week, max_hours_month, max_overtime_hours_week,
    } = req.body || {};
    if (!user_id || !name || cost_rate == null || selling_rate == null) {
      return res.status(400).json({ message: 'user_id, name, cost_rate and selling_rate are required' });
    }
    if (role && !canAssignRole({
      actingPlatformRole: req.user.role, actingTeamMemberRole: ctx.teamMemberRole,
      targetUserId: user_id, actingUserId: req.user.id, newRole: role,
    })) {
      return res.status(403).json({ message: 'You cannot assign that role' });
    }
    const { rows } = await query(
      `INSERT INTO team_members (user_id, name, email, cost_rate, selling_rate, currency, role, location,
         holiday_calendar, max_hours_day, max_hours_week, max_hours_month, max_overtime_hours_week, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [user_id, name, email || null, cost_rate, selling_rate, currency || 'AED', role || null, location || null,
        holiday_calendar || 'none', max_hours_day ?? 8, max_hours_week ?? 40, max_hours_month ?? 160,
        max_overtime_hours_week ?? 10, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'That user already has a TeamMember record' });
    next(err);
  }
});

// manageTeamMember — update: rate-change self-protection + role-rank gating.
teamMembersRouter.put('/:id', async (req, res, next) => {
  try {
    const { rows: existingRows } = await query('SELECT * FROM team_members WHERE id = $1', [req.params.id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ message: 'Not found' });

    const ctx = await loadCallerContext(req.user);
    const tier = resolveTier({ platformRole: req.user.role, teamMemberRole: ctx.teamMemberRole });
    const isSelf = existing.user_id === req.user.id;

    if (tier === 'user' && !isSelf) return res.status(403).json({ message: 'Not allowed' });
    if (tier === 'user' && isSelf) {
      if (req.body?.cost_rate !== undefined || req.body?.selling_rate !== undefined || req.body?.role !== undefined) {
        return res.status(403).json({ message: 'You cannot change your own rates or role' });
      }
    }
    if (req.body?.role !== undefined && req.body.role !== existing.role) {
      if (!canAssignRole({
        actingPlatformRole: req.user.role, actingTeamMemberRole: ctx.teamMemberRole,
        targetUserId: existing.user_id, actingUserId: req.user.id, newRole: req.body.role,
      })) {
        return res.status(403).json({ message: 'You cannot assign that role' });
      }
    }
    const cols = [
      'name', 'email', 'cost_rate', 'selling_rate', 'currency', 'role', 'location', 'holiday_calendar',
      'max_hours_day', 'max_hours_week', 'max_hours_month', 'max_overtime_hours_week',
    ].filter((c) => req.body?.[c] !== undefined);
    if (!cols.length) return res.json(existing);
    const setClauses = cols.map((c, i) => `${c} = $${i + 2}`);
    const values = cols.map((c) => req.body[c]);
    const { rows } = await query(
      `UPDATE team_members SET ${setClauses.join(', ')}, updated_date = now() WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// Delete stays platform-admin-only — the rank-gated create/update gives
// supervisors a way to manage their team without ever letting them remove
// an account outright.
teamMembersRouter.delete('/:id', async (req, res, next) => {
  try {
    const { rows: existingRows } = await query('SELECT * FROM team_members WHERE id = $1', [req.params.id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ message: 'Not found' });
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Not allowed' });
    if (existing.user_id === req.user.id) return res.status(400).json({ message: "You can't remove yourself" });
    await query('DELETE FROM team_members WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});
