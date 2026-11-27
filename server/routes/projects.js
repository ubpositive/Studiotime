// Ported from Base44's manageProject and listProjects
// (studiotime_discovery_notes.md §4 #4, #12). member_assignments is entirely
// server-derived: adding a user_id to assigned_members opens a new
// {user_id, from: today} window; removing one closes the existing open
// window with to: today — never client-supplied. Financial fields
// (hourly_rate/markup_percentage/stage_budgets) are only ever set when the
// caller's financial scope (server/lib/financialPerms.js) allows it; listing
// redacts them the same way via redactProject().
import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { loadCallerContext } from '../lib/callerContext.js';
import { resolveTier } from '../lib/roles.js';
import { loadFinancialScope, redactProject, defaultProjectAuthority } from '../lib/financialPerms.js';

export const projectsRouter = express.Router();
projectsRouter.use(requireAuth);

function projectAuthority(ctx, tier, userId, project) {
  const base = defaultProjectAuthority(tier);
  const isLeaderOrCreator = !!project && (project.project_leader_id === userId || project.created_by_id === userId);
  return {
    canAdd: base.add || ctx.permissions?.projects?.add === true,
    canEdit: base.edit || ctx.permissions?.projects?.edit === true || isLeaderOrCreator,
    canDelete: base.delete || ctx.permissions?.projects?.delete === true || isLeaderOrCreator,
  };
}

const today = () => new Date().toISOString().slice(0, 10);

projectsRouter.get('/', async (req, res, next) => {
  try {
    const ctx = await loadCallerContext(req.user);
    const finScope = loadFinancialScope({ platformRole: req.user.role, teamMemberRole: ctx.teamMemberRole, permissions: ctx.permissions });
    const viewAll = req.user.role === 'admin' || ctx.permissions?.projects?.view_all === true;
    const { rows } = await query('SELECT * FROM projects ORDER BY created_date DESC');
    const visible = viewAll ? rows : rows.filter((p) => {
      const assigned = Array.isArray(p.assigned_members) ? p.assigned_members : [];
      return p.project_leader_id === req.user.id || p.created_by_id === req.user.id || assigned.includes(req.user.id);
    });
    res.json(visible.map((p) => redactProject(p, finScope)));
  } catch (err) { next(err); }
});

projectsRouter.post('/', async (req, res, next) => {
  try {
    const ctx = await loadCallerContext(req.user);
    const tier = resolveTier({ platformRole: req.user.role, teamMemberRole: ctx.teamMemberRole });
    const auth = projectAuthority(ctx, tier, req.user.id, null);
    const body = req.body || {};
    const isCreatorOrLeader = body.project_leader_id === req.user.id;
    if (!auth.canAdd && !isCreatorOrLeader) return res.status(403).json({ message: 'Not allowed' });
    if (!body.name || !body.project_leader_id || !Array.isArray(body.active_stages) || !Array.isArray(body.active_tasks)) {
      return res.status(400).json({ message: 'name, project_leader_id, active_stages and active_tasks are required' });
    }
    const finScope = loadFinancialScope({ platformRole: req.user.role, teamMemberRole: ctx.teamMemberRole, permissions: ctx.permissions });
    const canSetFinancials = finScope.cost_settings.edit || finScope.budget.edit;
    const assigned_members = Array.isArray(body.assigned_members) ? body.assigned_members : [];
    const member_assignments = assigned_members.map((user_id) => ({ user_id, from: today() }));
    const { rows } = await query(
      `INSERT INTO projects (name, client, description, reference_code, location, project_type, status,
         project_leader_id, assigned_members, member_assignments, active_stages, active_tasks, budget_currency,
         hourly_rate, markup_percentage, stage_budgets, stage_date_mode, stage_dates, exchange_rates,
         start_date, end_date, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
      [body.name, body.client || null, body.description || null, body.reference_code || null, body.location || null,
        body.project_type || null, body.status || 'active', body.project_leader_id, JSON.stringify(assigned_members),
        JSON.stringify(member_assignments), JSON.stringify(body.active_stages), JSON.stringify(body.active_tasks),
        body.budget_currency || 'AED',
        canSetFinancials ? (body.hourly_rate ?? null) : null,
        canSetFinancials ? (body.markup_percentage ?? 0) : 0,
        JSON.stringify(canSetFinancials ? (body.stage_budgets || []) : []),
        body.stage_date_mode || 'stage', JSON.stringify(body.stage_dates || []),
        JSON.stringify(body.exchange_rates || { USD: 3.67, EUR: 4, GBP: 4.6 }),
        body.start_date || null, body.end_date || null, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

projectsRouter.put('/:id', async (req, res, next) => {
  try {
    const { rows: existingRows } = await query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const ctx = await loadCallerContext(req.user);
    const tier = resolveTier({ platformRole: req.user.role, teamMemberRole: ctx.teamMemberRole });
    const auth = projectAuthority(ctx, tier, req.user.id, existing);
    if (!auth.canEdit) return res.status(403).json({ message: 'Not allowed' });

    const finScope = loadFinancialScope({ platformRole: req.user.role, teamMemberRole: ctx.teamMemberRole, permissions: ctx.permissions });
    const canSetFinancials = finScope.cost_settings.edit || finScope.budget.edit;
    const body = req.body || {};

    let member_assignments = Array.isArray(existing.member_assignments) ? existing.member_assignments : [];
    let assigned_members = Array.isArray(existing.assigned_members) ? existing.assigned_members : [];
    if (Array.isArray(body.assigned_members)) {
      const next = body.assigned_members;
      const added = next.filter((id) => !assigned_members.includes(id));
      const removed = assigned_members.filter((id) => !next.includes(id));
      for (const userId of added) member_assignments = [...member_assignments, { user_id: userId, from: today() }];
      for (const userId of removed) {
        member_assignments = member_assignments.map((w) => (w.user_id === userId && !w.to ? { ...w, to: today() } : w));
      }
      assigned_members = next;
    }

    const simpleCols = ['name', 'client', 'description', 'reference_code', 'location', 'project_type', 'status',
      'project_leader_id', 'active_stages', 'active_tasks', 'budget_currency', 'stage_date_mode', 'stage_dates',
      'exchange_rates', 'start_date', 'end_date'];
    const jsonCols = new Set(['active_stages', 'active_tasks', 'stage_dates', 'exchange_rates']);
    const financialCols = ['hourly_rate', 'markup_percentage', 'stage_budgets'];

    const sets = ['assigned_members = $1', 'member_assignments = $2'];
    const values = [JSON.stringify(assigned_members), JSON.stringify(member_assignments)];
    for (const c of simpleCols) {
      if (body[c] !== undefined) {
        values.push(jsonCols.has(c) ? JSON.stringify(body[c]) : body[c]);
        sets.push(`${c} = $${values.length}`);
      }
    }
    for (const c of financialCols) {
      if (body[c] !== undefined && canSetFinancials) {
        values.push(c === 'stage_budgets' ? JSON.stringify(body[c]) : body[c]);
        sets.push(`${c} = $${values.length}`);
      }
    }
    values.push(req.params.id);
    const { rows } = await query(
      `UPDATE projects SET ${sets.join(', ')}, updated_date = now() WHERE id = $${values.length} RETURNING *`,
      values
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

projectsRouter.delete('/:id', async (req, res, next) => {
  try {
    const { rows: existingRows } = await query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const ctx = await loadCallerContext(req.user);
    const tier = resolveTier({ platformRole: req.user.role, teamMemberRole: ctx.teamMemberRole });
    const auth = projectAuthority(ctx, tier, req.user.id, existing);
    if (!auth.canDelete) return res.status(403).json({ message: 'Not allowed' });
    await query('DELETE FROM projects WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});
