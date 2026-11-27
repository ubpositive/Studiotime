// Ported from Base44's approveTimesheet (studiotime_discovery_notes.md §4
// #1), plus the Approvals-page feed, which reuses listRoster's own logic
// (listRosterCore, exported from ./teamMembers.js) with for_approval:true —
// i.e. resolveApprovalScope() per the DECIDED pure-per-project-scoping
// behavior in server/lib/approvalScope.js.
import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';
import { loadCallerContext, getLedProjectIds } from '../lib/callerContext.js';
import { resolveApprovalScope, entryInApprovalScope } from '../lib/approvalScope.js';
import { listRosterCore } from './teamMembers.js';

export const approvalsRouter = express.Router();
approvalsRouter.use(requireAuth);

approvalsRouter.get('/queue', async (req, res, next) => {
  try {
    res.json(await listRosterCore(req, { forApproval: true }));
  } catch (err) { next(err); }
});

// Nobody may approve/reject their own entry, even if their scope would
// otherwise cover it (e.g. a project_leader logging hours on their own
// led project).
async function canApprove(req, entry) {
  if (entry.user_id === req.user.id) return false;
  if (req.user.role === 'admin') return true;
  const ctx = await loadCallerContext(req.user);
  if (ctx.permissions?.timesheets?.approve === true) return true;
  const ledProjectIds = await getLedProjectIds(req.user.id);
  const scope = resolveApprovalScope({
    platformRole: req.user.role, teamMemberRole: ctx.teamMemberRole, permissions: ctx.permissions, ledProjectIds,
  });
  return entryInApprovalScope(entry, scope, req.user.id);
}

approvalsRouter.post('/:entryId/approve', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM timesheet_entries WHERE id = $1', [req.params.entryId]);
    const entry = rows[0];
    if (!entry) return res.status(404).json({ message: 'Not found' });
    if (entry.status !== 'submitted') return res.status(400).json({ message: 'Only submitted entries can be approved' });
    if (!(await canApprove(req, entry))) return res.status(403).json({ message: 'Not allowed' });
    const { rows: updated } = await query(
      `UPDATE timesheet_entries SET status = 'approved', approved_by = $1, approval_date = now(), rejection_reason = NULL, updated_date = now()
       WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.entryId]
    );
    res.json(updated[0]);
  } catch (err) { next(err); }
});

approvalsRouter.post('/:entryId/reject', async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    if (!reason || !reason.trim()) return res.status(400).json({ message: 'A rejection reason is required' });
    const { rows } = await query('SELECT * FROM timesheet_entries WHERE id = $1', [req.params.entryId]);
    const entry = rows[0];
    if (!entry) return res.status(404).json({ message: 'Not found' });
    if (entry.status !== 'submitted') return res.status(400).json({ message: 'Only submitted entries can be rejected' });
    if (!(await canApprove(req, entry))) return res.status(403).json({ message: 'Not allowed' });
    const { rows: updated } = await query(
      `UPDATE timesheet_entries SET status = 'rejected', approved_by = $1, approval_date = now(), rejection_reason = $2, updated_date = now()
       WHERE id = $3 RETURNING *`,
      [req.user.id, reason.trim(), req.params.entryId]
    );
    res.json(updated[0]);
  } catch (err) { next(err); }
});
