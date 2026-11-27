// Ported from Base44's saveTimesheet (studiotime_discovery_notes.md §4 #3).
// 7 actions: create, update, delete, recall, unlock, find_duplicates,
// delete_duplicates. There is no separate "submit" action — submission is a
// normal update that moves status draft -> submitted; the locking rules
// below are what make that transition one-way for the owner.
//
// NOTE on find/delete-duplicates: discovery captured the documented
// behavior (exact-match + a looser match, tie-broken by
// approved > submitted > draft > rejected) but not the original function's
// exact signature fields. This reimplements it using the fields that
// identify "the same logged time" (user, date, project, task, stage, plus
// hours/start/end for the exact match) — flagged here to spot-check against
// real exported data during the Task #13 dry run.
import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';

export const timesheetsRouter = express.Router();
timesheetsRouter.use(requireAuth);

function normalizeBillable(entry_type, is_billable) {
  // A break/leave entry (entry_type !== 'work') is always forced
  // non-billable server-side regardless of client input.
  return entry_type === 'work' ? !!is_billable : false;
}

const WRITABLE_FIELDS = [
  'entry_type', 'project_id', 'task', 'stage', 'hours', 'date', 'start_time', 'end_time',
  'break_minutes', 'is_billable', 'is_timer_running', 'timer_started_at', 'notes', 'status',
  'week_start', 'assigned_task_id',
];

timesheetsRouter.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const targetUserId = req.user.role === 'admin' && body.user_id ? body.user_id : req.user.id;
    if (!body.date || !body.week_start) return res.status(400).json({ message: 'date and week_start are required' });
    const entry_type = body.entry_type || 'work';
    const is_billable = normalizeBillable(entry_type, body.is_billable ?? true);
    const status = body.status === 'submitted' ? 'submitted' : 'draft';
    const { rows } = await query(
      `INSERT INTO timesheet_entries (user_id, entry_type, project_id, task, stage, hours, date, start_time, end_time,
         break_minutes, is_billable, is_timer_running, timer_started_at, notes, status, week_start, assigned_task_id, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [targetUserId, entry_type, body.project_id || null, body.task || null, body.stage || null, body.hours ?? null,
        body.date, body.start_time || null, body.end_time || null, body.break_minutes ?? 0, is_billable,
        !!body.is_timer_running, body.timer_started_at || null, body.notes || null, status, body.week_start,
        body.assigned_task_id || null, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

function isOwnerLocked(existing) {
  return existing.status === 'submitted' || existing.status === 'approved';
}

timesheetsRouter.put('/:id', async (req, res, next) => {
  try {
    const { rows: existingRows } = await query('SELECT * FROM timesheet_entries WHERE id = $1', [req.params.id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const isOwner = existing.user_id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Not allowed' });
    if (isOwner && !isAdmin && isOwnerLocked(existing)) {
      return res.status(400).json({ message: 'This entry is locked. Recall it to draft before editing.' });
    }
    const body = req.body || {};
    if (body.status !== undefined && !isAdmin) {
      const allowedOwnerTransition = existing.status === 'draft' && body.status === 'submitted';
      if (!allowedOwnerTransition && body.status !== existing.status) {
        return res.status(400).json({ message: 'You cannot set that status directly' });
      }
    }
    const cols = WRITABLE_FIELDS.filter((c) => body[c] !== undefined);
    if (!cols.length) return res.json(existing);
    const nextEntryType = body.entry_type !== undefined ? body.entry_type : existing.entry_type;
    const values = cols.map((c) => (c === 'is_billable' ? normalizeBillable(nextEntryType, body.is_billable) : body[c]));
    const setClauses = cols.map((c, i) => `${c} = $${i + 2}`);
    const { rows } = await query(
      `UPDATE timesheet_entries SET ${setClauses.join(', ')}, updated_date = now() WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

timesheetsRouter.delete('/:id', async (req, res, next) => {
  try {
    const { rows: existingRows } = await query('SELECT * FROM timesheet_entries WHERE id = $1', [req.params.id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const isOwner = existing.user_id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && (!isOwner || existing.status !== 'draft')) {
      return res.status(403).json({ message: 'Only your own draft entries can be deleted' });
    }
    await query('DELETE FROM timesheet_entries WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// recall — owner moves their own submitted (not yet approved) entry back to draft.
timesheetsRouter.post('/:id/recall', async (req, res, next) => {
  try {
    const { rows: existingRows } = await query('SELECT * FROM timesheet_entries WHERE id = $1', [req.params.id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ message: 'Not found' });
    if (existing.user_id !== req.user.id) return res.status(403).json({ message: 'Not allowed' });
    if (existing.status !== 'submitted') return res.status(400).json({ message: 'Only a submitted entry can be recalled' });
    const { rows } = await query(
      `UPDATE timesheet_entries SET status = 'draft', updated_date = now() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// unlock — admin-only, moves an approved entry back to draft.
timesheetsRouter.post('/:id/unlock', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Not allowed' });
    const { rows: existingRows } = await query('SELECT * FROM timesheet_entries WHERE id = $1', [req.params.id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ message: 'Not found' });
    if (existing.status !== 'approved') return res.status(400).json({ message: 'Only an approved entry can be unlocked' });
    const { rows } = await query(
      `UPDATE timesheet_entries SET status = 'draft', approved_by = NULL, approval_date = NULL, updated_date = now() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

const FINALITY = { approved: 3, submitted: 2, draft: 1, rejected: 0 };
function exactKey(e) { return [e.user_id, e.date, e.project_id, e.task, e.stage, e.hours, e.start_time, e.end_time].join('|'); }
function looseKey(e) { return [e.user_id, e.date, e.project_id, e.task, e.stage].join('|'); }

async function groupDuplicates() {
  const { rows: entries } = await query('SELECT * FROM timesheet_entries');
  const groups = new Map();
  for (const e of entries) {
    const key = `exact:${exactKey(e)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  for (const e of entries) {
    const key = `loose:${looseKey(e)}`;
    if (!groups.has(key)) groups.set(key, []);
    const arr = groups.get(key);
    if (!arr.includes(e)) arr.push(e);
  }
  const dupGroups = [];
  for (const [, arr] of groups) {
    if (arr.length > 1) {
      const sorted = [...arr].sort((a, b) => (FINALITY[b.status] ?? -1) - (FINALITY[a.status] ?? -1));
      dupGroups.push({ keep: sorted[0], remove: sorted.slice(1) });
    }
  }
  return dupGroups;
}

timesheetsRouter.get('/find-duplicates', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Not allowed' });
    const groups = await groupDuplicates();
    res.json({ groups: groups.map((g) => ({ keep_id: g.keep.id, remove_ids: [...new Set(g.remove.map((r) => r.id))] })) });
  } catch (err) { next(err); }
});

timesheetsRouter.post('/delete-duplicates', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Not allowed' });
    const groups = await groupDuplicates();
    const removeIds = [...new Set(groups.flatMap((g) => g.remove.map((r) => r.id)))];
    if (!removeIds.length) return res.json({ deleted: 0 });
    await query('DELETE FROM timesheet_entries WHERE id = ANY($1::uuid[])', [removeIds]);
    res.json({ deleted: removeIds.length });
  } catch (err) { next(err); }
});
