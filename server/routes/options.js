// Ported from Base44's manageOption (studiotime_discovery_notes.md §4 #16).
// Single-row CRUD for CustomOption already runs through the generic entity
// router (server/entities.js — admin create/update/delete, open read); this
// file adds only the one thing that router can't do: bulkUpdate, replacing
// every row for one list_type in a single call, admin-only, capped at 200
// rows, whitelisting exactly the same 5 fields the single-row CRUD exposes
// (pickOptionFields).
import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';

export const optionsRouter = express.Router();
optionsRouter.use(requireAuth);

const VALID_LIST_TYPES = ['stages', 'tasks', 'break_types', 'team_roles', 'hourly_rates'];
const MAX_BULK_ROWS = 200;

function pickOptionFields(row) {
  return {
    list_type: row.list_type,
    value: row.value,
    label: row.label,
    numeric_value: row.numeric_value ?? 0,
    sort_order: row.sort_order ?? 0,
  };
}

optionsRouter.post('/bulk-update', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Not allowed' });
    const { list_type, rows: rowsIn } = req.body || {};
    if (!VALID_LIST_TYPES.includes(list_type)) return res.status(400).json({ message: 'Invalid list_type' });
    if (!Array.isArray(rowsIn) || rowsIn.length > MAX_BULK_ROWS) {
      return res.status(400).json({ message: `rows must be an array of at most ${MAX_BULK_ROWS} items` });
    }
    for (const r of rowsIn) {
      if (!r.value || !r.label) return res.status(400).json({ message: 'Each row requires value and label' });
    }
    await query('DELETE FROM custom_options WHERE list_type = $1', [list_type]);
    const inserted = [];
    for (const r of rowsIn) {
      const f = pickOptionFields({ ...r, list_type });
      const { rows } = await query(
        `INSERT INTO custom_options (list_type, value, label, numeric_value, sort_order, created_by_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [f.list_type, f.value, f.label, f.numeric_value, f.sort_order, req.user.id]
      );
      inserted.push(rows[0]);
    }
    res.json(inserted);
  } catch (err) { next(err); }
});
