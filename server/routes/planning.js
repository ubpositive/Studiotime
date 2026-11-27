// Ported from Base44's assignTask, reassignMembers, resolveAssignmentConflict,
// listResourcePlan and stageCapacity (studiotime_discovery_notes.md §4
// #9-11, #13, #17).
import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { loadCallerContext } from '../lib/callerContext.js';
import { isAdminLevelRole } from '../lib/roles.js';
import { resolvePlanningAccess, projectInScope } from '../lib/planningAccess.js';

export const planningRouter = express.Router();
planningRouter.use(requireAuth);

async function loadVisibleProjects(req, ctx) {
  const { rows } = await query('SELECT * FROM projects');
  const access = resolvePlanningAccess({ platformRole: req.user.role, teamMemberRole: ctx.teamMemberRole, permissions: ctx.permissions });
  if (req.user.role === 'admin' || access.viewAllProjects) return { rows, access };
  return { rows: rows.filter((p) => projectInScope(p, req.user.id)), access };
}

// ---- assignTask -----------------------------------------------------------
planningRouter.post('/tasks', async (req, res, next) => {
  try {
    const { project_id, assigned_to_user_id, task, stage, description, due_date, estimated_hours } = req.body || {};
    if (!project_id || !assigned_to_user_id || !task || !stage) {
      return res.status(400).json({ message: 'project_id, assigned_to_user_id, task and stage are required' });
    }
    const { rows: projRows } = await query('SELECT * FROM projects WHERE id = $1', [project_id]);
    const project = projRows[0];
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const ctx = await loadCallerContext(req.user);
    const isLeaderOrCreator = project.project_leader_id === req.user.id || project.created_by_id === req.user.id;
    const canAssign = req.user.role === 'admin' || isLeaderOrCreator || isAdminLevelRole(ctx.teamMemberRole)
      || ctx.permissions?.project_members?.add === true;
    if (!canAssign) return res.status(403).json({ message: 'Not allowed' });

    const assigned = Array.isArray(project.assigned_members) ? project.assigned_members : [];
    if (!assigned.includes(assigned_to_user_id)) {
      return res.status(400).json({ message: 'That person is not on this project team' });
    }

    const { rows } = await query(
      `INSERT INTO task_assignments (project_id, assigned_to_user_id, assigned_by_user_id, task, stage, description,
         due_date, estimated_hours, status, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$3) RETURNING *`,
      [project_id, assigned_to_user_id, req.user.id, task, stage, description || null, due_date || null, estimated_hours ?? null]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// Status updates (open/in_progress/done) aren't one of the 17 documented
// functions by name, but the assignee/assigner clearly needs a way to move
// a task along — kept minimal and narrowly scoped to the people already
// involved with the assignment.
planningRouter.put('/tasks/:id', async (req, res, next) => {
  try {
    const { rows: existingRows } = await query('SELECT * FROM task_assignments WHERE id = $1', [req.params.id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const allowed = req.user.role === 'admin' || existing.assigned_to_user_id === req.user.id
      || existing.assigned_by_user_id === req.user.id || existing.created_by_id === req.user.id;
    if (!allowed) return res.status(403).json({ message: 'Not allowed' });
    const { status } = req.body || {};
    if (!status || !['open', 'in_progress', 'done'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const { rows } = await query(
      `UPDATE task_assignments SET status = $1, updated_date = now() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

planningRouter.delete('/tasks/:id', async (req, res, next) => {
  try {
    const { rows: existingRows } = await query('SELECT * FROM task_assignments WHERE id = $1', [req.params.id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const allowed = req.user.role === 'admin' || existing.assigned_by_user_id === req.user.id || existing.created_by_id === req.user.id;
    if (!allowed) return res.status(403).json({ message: 'Not allowed' });
    await query('DELETE FROM task_assignments WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ---- reassignMembers --------------------------------------------------------
// Bulk assign/remove any number of team members on one project for a date
// range, straight from the resource planner. Merges/splits member_assignments
// windows without ever touching logged hours.
function addWindow(windows, userId, from, to) {
  return [...windows, { user_id: userId, from, ...(to ? { to } : {}) }];
}
function removeWindow(windows, userId, from) {
  let closed = false;
  return windows.map((w) => {
    if (!closed && w.user_id === userId && !w.to) { closed = true; return { ...w, to: from }; }
    return w;
  });
}

planningRouter.post('/reassign', async (req, res, next) => {
  try {
    const { project_id, add_user_ids = [], remove_user_ids = [], from, to } = req.body || {};
    if (!project_id || !from) return res.status(400).json({ message: 'project_id and from are required' });
    const { rows: projRows } = await query('SELECT * FROM projects WHERE id = $1', [project_id]);
    const project = projRows[0];
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const ctx = await loadCallerContext(req.user);
    const access = resolvePlanningAccess({ platformRole: req.user.role, teamMemberRole: ctx.teamMemberRole, permissions: ctx.permissions });
    const allowed = req.user.role === 'admin' || (access.canViewTeam && projectInScope(project, req.user.id));
    if (!allowed) return res.status(403).json({ message: 'Not allowed' });

    let windows = Array.isArray(project.member_assignments) ? project.member_assignments : [];
    let members = Array.isArray(project.assigned_members) ? project.assigned_members : [];

    for (const userId of add_user_ids) {
      if (!members.includes(userId)) members = [...members, userId];
      windows = addWindow(windows, userId, from, to || null);
    }
    for (const userId of remove_user_ids) {
      windows = removeWindow(windows, userId, from);
      const stillCovered = windows.some((w) => w.user_id === userId && !w.to);
      if (!stillCovered) members = members.filter((id) => id !== userId);
    }

    const { rows } = await query(
      `UPDATE projects SET assigned_members = $1, member_assignments = $2, updated_date = now() WHERE id = $3 RETURNING *`,
      [JSON.stringify(members), JSON.stringify(windows), project_id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ---- resolveAssignmentConflict ----------------------------------------------
planningRouter.post('/conflicts/resolve', async (req, res, next) => {
  try {
    const { project_id, user_id, work_date, resolution } = req.body || {};
    if (!project_id || !user_id || !work_date || !['assigned', 'dismissed'].includes(resolution)) {
      return res.status(400).json({ message: 'project_id, user_id, work_date and a valid resolution are required' });
    }
    const { rows: projRows } = await query('SELECT * FROM projects WHERE id = $1', [project_id]);
    const project = projRows[0];
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (req.user.role !== 'admin' && !projectInScope(project, req.user.id)) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    if (resolution === 'assigned') {
      let windows = Array.isArray(project.member_assignments) ? project.member_assignments : [];
      const hasOpenWindow = windows.some((w) => w.user_id === user_id && !w.to);
      if (!hasOpenWindow) windows = addWindow(windows, user_id, work_date, null);
      let members = Array.isArray(project.assigned_members) ? project.assigned_members : [];
      if (!members.includes(user_id)) members = [...members, user_id];
      await query(
        `UPDATE projects SET assigned_members = $1, member_assignments = $2, updated_date = now() WHERE id = $3`,
        [JSON.stringify(members), JSON.stringify(windows), project_id]
      );
    }
    // Logged TimesheetEntry rows are never modified either way.
    const { rows } = await query(
      `INSERT INTO assignment_conflicts (project_id, user_id, work_date, resolution, resolved_by_email, resolved_at, created_by_id)
       VALUES ($1,$2,$3,$4,$5,now(),$6) RETURNING *`,
      [project_id, user_id, work_date, resolution, req.user.email, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ---- listResourcePlan -------------------------------------------------------
// Hours-only, allocation-only planner feed — never returns rates or contact
// details.
planningRouter.get('/resource-plan', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const ctx = await loadCallerContext(req.user);
    const { rows: projects, access } = await loadVisibleProjects(req, ctx);

    const { rows: members } = await query('SELECT id, user_id, name, role, max_hours_week FROM team_members ORDER BY name ASC');
    const roster = (req.user.role === 'admin' || access.canViewTeam) ? members : members.filter((m) => m.user_id === req.user.id);

    const projectIds = projects.map((p) => p.id);
    const safeIds = projectIds.length ? projectIds : ['00000000-0000-0000-0000-000000000000'];

    const { rows: entries } = await query(
      `SELECT * FROM timesheet_entries WHERE entry_type = 'work' AND project_id = ANY($1::uuid[])
         AND date >= $2 AND date <= $3`,
      [safeIds, from || '0001-01-01', to || '9999-12-31']
    );
    const { rows: dismissed } = await query(
      `SELECT * FROM assignment_conflicts WHERE resolution = 'dismissed' AND project_id = ANY($1::uuid[])`,
      [safeIds]
    );

    const plan = projects.map((p) => {
      const windows = Array.isArray(p.member_assignments) ? p.member_assignments : [];
      const assigned = Array.isArray(p.assigned_members) ? p.assigned_members : [];
      const allocations = assigned.map((userId) => {
        const userWindows = windows.filter((w) => w.user_id === userId);
        if (userWindows.length) return { user_id: userId, windows: userWindows };
        const firstEntry = entries
          .filter((e) => e.project_id === p.id && e.user_id === userId)
          .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
        return { user_id: userId, windows: firstEntry ? [{ user_id: userId, from: firstEntry.date }] : [] };
      });
      return { id: p.id, name: p.name, status: p.status, active_stages: p.active_stages, active_tasks: p.active_tasks, allocations };
    });

    res.json({
      projects: plan,
      roster: roster.map((m) => ({ id: m.id, user_id: m.user_id, name: m.name, role: m.role, max_hours_week: m.max_hours_week })),
      hours: entries.map((e) => ({ project_id: e.project_id, user_id: e.user_id, date: e.date, hours: e.hours })),
      dismissed_conflicts: dismissed.map((d) => ({ project_id: d.project_id, user_id: d.user_id, work_date: d.work_date })),
    });
  } catch (err) { next(err); }
});

// ---- stageCapacity -----------------------------------------------------------
// How many hours a project's currently-assigned members can still give
// before each expected stage/task completion date. Each member's weekly cap
// is divided evenly across every OTHER active project they're concurrently
// assigned to. Hours-only, no rates/contacts.
//
// NOTE: discovery captured the concept (weekly cap divided across concurrent
// active projects, over workdays in the window) but not the exact formula.
// This is a best-effort reconstruction — flagged for a spot-check against
// real exported data during the Task #13 dry run.
const MAX_STAGE_CAPACITY_ROWS = 200;
const MAX_LOOKAHEAD_DAYS = 730;

function isWeekday(date) {
  const d = date.getDay();
  return d !== 0 && d !== 6;
}

planningRouter.post('/stage-capacity', async (req, res, next) => {
  try {
    const rowsIn = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, MAX_STAGE_CAPACITY_ROWS) : [];
    if (!rowsIn.length) return res.json({ rows: [] });

    const { rows: allProjects } = await query(`SELECT * FROM projects WHERE status = 'active'`);
    const { rows: allMembers } = await query('SELECT user_id, max_hours_week FROM team_members');
    const capByUser = new Map(allMembers.map((m) => [m.user_id, Number(m.max_hours_week) || 40]));

    const out = [];
    for (const row of rowsIn) {
      const project = allProjects.find((p) => p.id === row.project_id);
      if (!project) { out.push({ ...row, error: 'Project not found or not active' }); continue; }
      const expectedEnd = new Date(row.expected_end || project.end_date || Date.now());
      const todayDate = new Date();
      const days = Math.min(Math.max(0, Math.round((expectedEnd - todayDate) / 86400000)), MAX_LOOKAHEAD_DAYS);

      const assigned = Array.isArray(project.assigned_members) ? project.assigned_members : [];
      const members = assigned.map((userId) => {
        const concurrentProjects = allProjects.filter((p) =>
          p.id !== project.id && Array.isArray(p.assigned_members) && p.assigned_members.includes(userId)
        ).length;
        const weeklyCap = capByUser.get(userId) || 40;
        const share = weeklyCap / (1 + concurrentProjects);
        let weekdays = 0;
        for (let i = 0; i < days; i++) {
          const d = new Date(todayDate);
          d.setDate(d.getDate() + i);
          if (isWeekday(d)) weekdays++;
        }
        const availableHours = (weekdays / 5) * share;
        return { user_id: userId, available_hours: Math.round(availableHours * 100) / 100 };
      });

      out.push({ project_id: project.id, stage: row.stage, task: row.task, expected_end: row.expected_end, members });
    }
    res.json({ rows: out });
  } catch (err) { next(err); }
});
