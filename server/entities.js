import express from 'express';
import { query } from './db.js';
import { requireAuth } from './auth.js';

// ---------------------------------------------------------------------------
// Generic entity CRUD, standing in for Base44's `entities.<Name>` SDK module.
//
// Unlike FireShield-Pro/StaffSync Pro, most of StudioTime's real entities had
// Base44 RLS of "create/update/delete: admin-only", with the ACTUAL write
// path going through a service-role backend function that layered on real
// business logic (member_assignments window-tracking, timesheet lifecycle
// locking, role-rank gating, permission merge-per-area, etc.) — logic a
// blind admin-gated INSERT/UPDATE here cannot reproduce and would let a
// caller bypass entirely if this router also exposed it.
//
// So for those entities, canCreate/canUpdate/canDelete are hard-wired false
// here: writes are only possible through the dedicated business-logic routes
// in server/routes/*.js (Task #23), which call into server/lib/* for the
// actual authority checks before touching the database directly. This router
// still serves reads for them (scoped to what Base44's RLS allowed to read),
// and the User entity itself isn't here at all — it's owned by auth.js.
//
// A few entities have no such bypass in the original app (PendingInvite,
// CustomOption, AppSetting) and are safe to expose through plain admin-gated
// generic CRUD, same as the sibling apps.
// ---------------------------------------------------------------------------

const isAdmin = (u) => u.role === 'admin';
const READ_OPEN = () => true;
const WRITE_BLOCKED = () => false;

function ownsRow(field) {
  return (u, row) => row[field] === u.id || u.role === 'admin';
}

const ENTITY_CONFIGS = {
  TeamMember: {
    table: 'team_members',
    columns: [
      'user_id', 'name', 'email', 'cost_rate', 'selling_rate', 'currency', 'role', 'location',
      'holiday_calendar', 'max_hours_day', 'max_hours_week', 'max_hours_month', 'max_overtime_hours_week',
    ],
    // Real writes go through server/routes/teamMembers.js (manageTeamMember):
    // rate-change self-protection + role-rank gating (server/lib/roles.js).
    canCreate: WRITE_BLOCKED,
    canRead: ownsRow('user_id'),
    canUpdate: WRITE_BLOCKED,
    canDelete: WRITE_BLOCKED,
  },
  PendingInvite: {
    table: 'pending_invites',
    columns: ['email', 'role'],
    canCreate: isAdmin,
    canRead: isAdmin,
    canUpdate: isAdmin,
    canDelete: isAdmin,
  },
  Project: {
    table: 'projects',
    columns: [
      'name', 'client', 'description', 'reference_code', 'location', 'project_type', 'status',
      'project_leader_id', 'assigned_members', 'member_assignments', 'active_stages', 'active_tasks',
      'budget_currency', 'hourly_rate', 'markup_percentage', 'stage_budgets', 'stage_date_mode',
      'stage_dates', 'exchange_rates', 'start_date', 'end_date',
    ],
    // Real writes go through server/routes/projects.js (manageProject):
    // financial-permission-gated cost/budget edits, and member_assignments
    // windows are entirely server-derived there, never client-supplied.
    canCreate: WRITE_BLOCKED,
    canRead: (u, row) => {
      if (u.role === 'admin') return true;
      if (row.project_leader_id === u.id || row.created_by_id === u.id) return true;
      const assigned = Array.isArray(row.assigned_members) ? row.assigned_members : [];
      return assigned.includes(u.id);
    },
    canUpdate: WRITE_BLOCKED,
    canDelete: WRITE_BLOCKED,
  },
  TaskAssignment: {
    table: 'task_assignments',
    columns: ['project_id', 'assigned_to_user_id', 'assigned_by_user_id', 'task', 'stage', 'description', 'due_date', 'estimated_hours', 'status'],
    // Real creation goes through server/routes/planning.js (assignTask):
    // validates the assignee is actually on the project team and forces
    // assigned_by_user_id server-side.
    canCreate: WRITE_BLOCKED,
    canRead: (u, row) => u.role === 'admin' || row.assigned_to_user_id === u.id || row.assigned_by_user_id === u.id || row.created_by_id === u.id,
    canUpdate: (u, row) => u.role === 'admin' || row.assigned_to_user_id === u.id || row.assigned_by_user_id === u.id || row.created_by_id === u.id,
    canDelete: (u, row) => u.role === 'admin' || row.assigned_by_user_id === u.id || row.created_by_id === u.id,
  },
  TimesheetEntry: {
    table: 'timesheet_entries',
    columns: [
      'user_id', 'entry_type', 'project_id', 'task', 'stage', 'hours', 'date', 'start_time', 'end_time',
      'break_minutes', 'is_billable', 'is_timer_running', 'timer_started_at', 'notes', 'status',
      'approved_by', 'approval_date', 'rejection_reason', 'week_start', 'assigned_task_id',
    ],
    // All writes — including the owner's own — go through
    // server/routes/timesheets.js (saveTimesheet) and approvals.js
    // (approveTimesheet): draft/submitted/approved/rejected lifecycle
    // locking, forced non-billable on non-work entries, recall/unlock rules,
    // and approval-scope gating (server/lib/approvalScope.js) none of which
    // a direct UPDATE here could enforce.
    canCreate: WRITE_BLOCKED,
    canRead: ownsRow('user_id'),
    canUpdate: WRITE_BLOCKED,
    canDelete: WRITE_BLOCKED,
  },
  UserPermission: {
    table: 'user_permissions',
    columns: ['user_id', 'is_domain_admin', 'permissions', 'updated_by'],
    // Real writes go through server/routes/permissions.js
    // (manageUserPermission): merges per PERMISSION_SHAPE area rather than
    // overwriting wholesale, and is_domain_admin changes are gated by
    // server/lib/adminAuthority.js, not a plain admin check.
    canCreate: WRITE_BLOCKED,
    canRead: ownsRow('user_id'),
    canUpdate: WRITE_BLOCKED,
    canDelete: WRITE_BLOCKED,
  },
  AssignmentConflict: {
    table: 'assignment_conflicts',
    columns: ['project_id', 'user_id', 'work_date', 'resolution', 'resolved_by_email', 'resolved_at'],
    // Written only via server/routes/planning.js
    // (resolveAssignmentConflict): assign/dismiss, scoped to projects the
    // caller can already open (server/lib/planningAccess.js), not a blanket
    // admin check.
    canCreate: WRITE_BLOCKED,
    canRead: isAdmin,
    canUpdate: WRITE_BLOCKED,
    canDelete: WRITE_BLOCKED,
  },
  AccountStatusAudit: {
    table: 'account_status_audit',
    columns: ['target_user_id', 'target_name', 'target_email', 'action', 'reason', 'performed_by_id', 'performed_by_email', 'performed_at'],
    // Immutable audit trail, written only as a side effect of
    // server/routes/permissions.js (manageAccountStatus) — never directly,
    // even by an admin.
    canCreate: WRITE_BLOCKED,
    canRead: isAdmin,
    canUpdate: WRITE_BLOCKED,
    canDelete: WRITE_BLOCKED,
  },
  CustomOption: {
    table: 'custom_options',
    columns: ['list_type', 'value', 'label', 'numeric_value', 'sort_order'],
    // Everyone needs to read these to render selects (stages/tasks/break
    // types/team roles/hourly rate presets); only admins curate them. The
    // bulk-update convenience endpoint (manageOption's bulkUpdate, up to 200
    // rows) lives in server/routes/options.js on top of this plain CRUD.
    canCreate: isAdmin,
    canRead: READ_OPEN,
    canUpdate: isAdmin,
    canDelete: isAdmin,
  },
  AppSetting: {
    table: 'app_settings',
    columns: ['key', 'value'],
    canCreate: isAdmin,
    canRead: READ_OPEN,
    canUpdate: isAdmin,
    canDelete: isAdmin,
  },
};

function rowToJson(config, row) {
  const out = { id: row.id, created_by_id: row.created_by_id };
  for (const col of config.columns) out[col] = row[col];
  out.created_date = row.created_date;
  out.updated_date = row.updated_date;
  return out;
}

// Parses base44-style sort strings, e.g. "-created_date" or "sort_order,label".
function parseSort(config, sortParam) {
  if (!sortParam) return [{ col: 'created_date', dir: 'DESC' }];
  const parts = String(sortParam).split(',').map((s) => s.trim()).filter(Boolean);
  const clauses = parts.map((field) => {
    const dir = field.startsWith('-') ? 'DESC' : 'ASC';
    const name = field.replace(/^-/, '');
    const col = name === 'created_date' ? 'created_date'
      : name === 'updated_date' ? 'updated_date'
      : name === 'id' ? 'id'
      : config.columns.includes(name) ? name
      : null;
    return col ? { col, dir } : null;
  }).filter(Boolean);
  return clauses.length ? clauses : [{ col: 'created_date', dir: 'DESC' }];
}

function orderByClause(clauses) {
  return clauses.map((c) => `${c.col} ${c.dir} NULLS LAST`).join(', ');
}

// JSONB columns need their value passed through JSON.stringify before being
// bound as a query parameter; everything else passes through unchanged.
function toSqlValue(v) {
  return (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
}

export function makeEntityRouter(name) {
  const config = ENTITY_CONFIGS[name];
  if (!config) throw new Error(`Unknown entity: ${name}`);
  const router = express.Router();
  router.use(requireAuth);

  // list: GET /?sort=-created_date&limit=1000
  router.get('/', async (req, res, next) => {
    try {
      const clauses = parseSort(config, req.query.sort);
      const limit = Math.min(parseInt(req.query.limit, 10) || 1000, 1000);
      const { rows } = await query(
        `SELECT * FROM ${config.table} ORDER BY ${orderByClause(clauses)} LIMIT $1`,
        [limit]
      );
      const visible = rows.filter((r) => config.canRead(req.user, r));
      res.json(visible.map((r) => rowToJson(config, r)));
    } catch (err) { next(err); }
  });

  // filter: POST /filter  { field: value, ... }?sort=-date — equality match + optional sort
  router.post('/filter', async (req, res, next) => {
    try {
      const filters = req.body || {};
      const keys = Object.keys(filters).filter((k) => config.columns.includes(k) || k === 'id');
      const clauses = keys.map((k, i) => `${k} = $${i + 1}`);
      const values = keys.map((k) => filters[k]);
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const order = parseSort(config, req.query.sort);
      const { rows } = await query(
        `SELECT * FROM ${config.table} ${where} ORDER BY ${orderByClause(order)}`,
        values
      );
      const visible = rows.filter((r) => config.canRead(req.user, r));
      res.json(visible.map((r) => rowToJson(config, r)));
    } catch (err) { next(err); }
  });

  // get: GET /:id — single record (detail pages)
  router.get('/:id', async (req, res, next) => {
    try {
      const { rows } = await query(`SELECT * FROM ${config.table} WHERE id = $1`, [req.params.id]);
      const row = rows[0];
      if (!row) return res.status(404).json({ message: 'Not found' });
      if (!config.canRead(req.user, row)) return res.status(403).json({ message: 'Not allowed' });
      res.json(rowToJson(config, row));
    } catch (err) { next(err); }
  });

  router.post('/', async (req, res, next) => {
    try {
      if (!config.canCreate(req.user)) return res.status(403).json({ message: 'Not allowed' });
      const payload = req.body || {};
      const cols = config.columns.filter((c) => payload[c] !== undefined);
      const values = cols.map((c) => toSqlValue(payload[c]));
      const placeholders = cols.map((_, i) => `$${i + 2}`);
      const { rows } = await query(
        `INSERT INTO ${config.table} (created_by_id${cols.length ? ', ' + cols.join(', ') : ''})
         VALUES ($1${placeholders.length ? ', ' + placeholders.join(', ') : ''}) RETURNING *`,
        [req.user.id, ...values]
      );
      res.json(rowToJson(config, rows[0]));
    } catch (err) { next(err); }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const { rows: existingRows } = await query(`SELECT * FROM ${config.table} WHERE id = $1`, [req.params.id]);
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ message: 'Not found' });
      if (!config.canUpdate(req.user, existing)) return res.status(403).json({ message: 'Not allowed' });
      const payload = req.body || {};
      const cols = config.columns.filter((c) => payload[c] !== undefined);
      if (cols.length === 0) return res.json(rowToJson(config, existing));
      const setClauses = cols.map((c, i) => `${c} = $${i + 2}`);
      const values = cols.map((c) => toSqlValue(payload[c]));
      const { rows } = await query(
        `UPDATE ${config.table} SET ${setClauses.join(', ')}, updated_date = now()
         WHERE id = $1 RETURNING *`,
        [req.params.id, ...values]
      );
      res.json(rowToJson(config, rows[0]));
    } catch (err) { next(err); }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const { rows: existingRows } = await query(`SELECT * FROM ${config.table} WHERE id = $1`, [req.params.id]);
      const existing = existingRows[0];
      if (!existing) return res.status(404).json({ message: 'Not found' });
      if (!config.canDelete(req.user, existing)) return res.status(403).json({ message: 'Not allowed' });
      await query(`DELETE FROM ${config.table} WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  return router;
}

// Real-time parity: Base44's `.subscribe()` pushed live updates over a
// websocket. The frontend shim (src/api/base44Client.js) polls this
// lightweight "has anything changed" endpoint instead.
export function registerChangeFeedRoute(app) {
  app.get('/api/entities/:name/changed-since', requireAuth, async (req, res, next) => {
    try {
      const config = ENTITY_CONFIGS[req.params.name];
      if (!config) return res.status(404).json({ message: 'Unknown entity' });
      const since = req.query.since ? new Date(req.query.since) : new Date(0);
      const { rows } = await query(
        `SELECT count(*)::int AS n FROM ${config.table} WHERE updated_date > $1`,
        [since]
      );
      res.json({ changed: rows[0].n > 0, now: new Date().toISOString() });
    } catch (err) { next(err); }
  });
}

export { ENTITY_CONFIGS };
