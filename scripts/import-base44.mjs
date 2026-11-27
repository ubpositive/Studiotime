#!/usr/bin/env node
// StudioTime Base44 -> Postgres dry-run importer (Task #13).
//
// Reads the CSVs Base44 exports from Dashboard -> Data -> [table] -> ... ->
// Export, remaps Base44's Mongo-style ObjectId ids to fresh Postgres UUIDs
// (keeping a consistent old-id -> new-uuid map so every foreign key still
// points at the right row), and loads everything into a Postgres database
// inside ONE transaction. By default the transaction is rolled back at the
// end (true dry run, nothing kept) -- pass --commit to keep it.
//
// Usage:
//   node import.mjs --raw <dir> --database-url <url> [--commit] [--users <file>]
//
// --users accepts a CSV with columns: id,email,full_name,role,approved,account_status
// (role is the PLATFORM role: user/admin -- not the TeamMember studio role).
// When omitted, users are reconstructed as best as possible from TeamMember
// rows (real email/name, but platform role defaults to 'user' since that
// isn't visible anywhere in the TeamMember/Project/TimesheetEntry exports),
// and any other referenced id gets a clearly-flagged placeholder so the
// import can still be test-run end to end -- see the "UNRESOLVED USERS"
// section of the report.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';

function parseArgs(argv) {
  const out = { commit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--raw') out.raw = argv[++i];
    else if (a === '--database-url') out.databaseUrl = argv[++i];
    else if (a === '--users') out.users = argv[++i];
    else if (a === '--commit') out.commit = true;
  }
  if (!out.raw || !out.databaseUrl) {
    console.error('Usage: node import.mjs --raw <dir> --database-url <url> [--commit] [--users <file>]');
    process.exit(1);
  }
  return out;
}

// --- minimal CSV parser (handles quoted fields with embedded commas/quotes/newlines) ---
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).filter((r) => r.length > 1 || r[0] !== '').map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] ?? ''; });
    return obj;
  });
}

function loadCsv(dir, name) {
  const file = path.join(dir, `${name}_export.csv`);
  if (!fs.existsSync(file)) return [];
  return parseCsv(fs.readFileSync(file, 'utf8'));
}

const nullIfEmpty = (v) => (v === '' || v === undefined ? null : v);
const toNum = (v) => (v === '' || v === undefined || v === null ? null : Number(v));
const toBool = (v) => v === 'true' || v === true;
const toJson = (v, dflt) => (v ? JSON.parse(v) : dflt);
const toDate = (v) => nullIfEmpty(v);
const toTime = (v) => nullIfEmpty(v);
const toTimestamp = (v) => nullIfEmpty(v);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const RAW = args.raw;

  const teamMembers = loadCsv(RAW, 'TeamMember');
  const projects = loadCsv(RAW, 'Project');
  const timesheets = loadCsv(RAW, 'TimesheetEntry');
  const taskAssignments = loadCsv(RAW, 'TaskAssignment');
  const userPermissions = loadCsv(RAW, 'UserPermission');
  const pendingInvites = loadCsv(RAW, 'PendingInvite');
  const customOptions = loadCsv(RAW, 'CustomOption');
  const appSettings = loadCsv(RAW, 'AppSetting');
  const assignmentConflicts = loadCsv(RAW, 'AssignmentConflict');
  const accountStatusAudit = loadCsv(RAW, 'AccountStatusAudit');
  const usersFile = args.users ? parseCsv(fs.readFileSync(args.users, 'utf8')) : [];

  const report = { warnings: [], unresolvedUsers: new Set(), counts: {} };

  // ---- ID remap: Base44 ObjectId-style id -> fresh Postgres UUID. One global
  // map is safe because Base44 ids are unique across every collection. ----
  const idMap = new Map();
  function newId(oldId) {
    if (!oldId) return null;
    if (!idMap.has(oldId)) idMap.set(oldId, crypto.randomUUID());
    return idMap.get(oldId);
  }
  // created_by_id (and similar) sometimes holds Base44's internal
  // "service_..." system-account id rather than a real user -- there is
  // nothing to migrate it to, so it becomes NULL (system-created).
  function userRef(oldId) {
    if (!oldId) return null;
    if (oldId.startsWith('service_')) return null;
    return newId(oldId);
  }

  // ---- Build the users table ----
  // Priority: explicit --users file > TeamMember row (real email/name) >
  // placeholder (flagged unresolved).
  const usersById = new Map(); // oldId -> {id,email,full_name,role,approved,account_status}
  for (const u of usersFile) {
    usersById.set(u.id, {
      oldId: u.id,
      email: u.email,
      full_name: nullIfEmpty(u.full_name),
      role: u.role === 'admin' ? 'admin' : 'user',
      approved: toBool(u.approved),
      account_status: u.account_status === 'disabled' ? 'disabled' : 'active',
      source: 'users-file',
    });
  }
  for (const tm of teamMembers) {
    if (!usersById.has(tm.user_id)) {
      usersById.set(tm.user_id, {
        oldId: tm.user_id,
        email: tm.email || `needs-email+${tm.user_id.slice(-6)}@studiotime.import`,
        full_name: tm.name,
        role: 'user', // platform role isn't visible in TeamMember -- not derivable
        approved: true, // an active TeamMember is, practically, an active account
        account_status: 'active',
        source: tm.email ? 'team-member' : 'team-member-no-email',
      });
    }
  }
  // Any other id referenced anywhere (Project leader/assigned, TimesheetEntry
  // user/approver, TaskAssignment assignee/assigner, UserPermission.user_id)
  // that still has no user row gets collected here rather than given its own
  // placeholder -- per your call, these are presumed old test data with no
  // real identity behind them, so every one of them is folded into a single
  // shared "legacy data" account below instead of 8 separate fake people.
  function ensurePlaceholder(oldId) {
    if (!oldId || oldId.startsWith('service_')) return;
    if (usersById.has(oldId)) return;
    report.unresolvedUsers.add(oldId);
  }
  for (const p of projects) {
    ensurePlaceholder(p.project_leader_id);
    ensurePlaceholder(p.created_by_id);
    for (const uid of toJson(p.assigned_members, [])) ensurePlaceholder(uid);
    for (const w of toJson(p.member_assignments, [])) ensurePlaceholder(w.user_id);
  }
  for (const t of timesheets) {
    ensurePlaceholder(t.user_id);
    ensurePlaceholder(t.approved_by);
    ensurePlaceholder(t.created_by_id);
  }
  for (const ta of taskAssignments) {
    ensurePlaceholder(ta.assigned_to_user_id);
    ensurePlaceholder(ta.assigned_by_user_id);
    ensurePlaceholder(ta.created_by_id);
  }
  for (const up of userPermissions) {
    ensurePlaceholder(up.user_id);
    ensurePlaceholder(up.created_by_id);
  }

  // Fold every unresolved id into ONE shared "legacy data" account rather
  // than a placeholder per id -- these are presumed old test data with no
  // real identity behind them (none hold a UserPermission override, approve
  // anything, lead a project, or get assigned a task -- they only show up as
  // project members and as the owner of logged timesheet hours), so there's
  // one place to look at all of it and decide whether to delete it.
  // account_status: 'disabled' means this account can never log in --
  // server/auth.js rejects any login/session check once that's set.
  const LEGACY_DUMMY_OLD_ID = '__legacy_test_data__';
  if (report.unresolvedUsers.size) {
    usersById.set(LEGACY_DUMMY_OLD_ID, {
      oldId: LEGACY_DUMMY_OLD_ID,
      email: 'legacy-test-data@studiotime.import',
      full_name: 'Legacy / unassigned test data (review before cutover)',
      role: 'user',
      approved: false,
      account_status: 'disabled',
      source: 'legacy-dummy',
    });
    const dummyNewId = newId(LEGACY_DUMMY_OLD_ID);
    for (const oldId of report.unresolvedUsers) idMap.set(oldId, dummyNewId);
  }

  // UserPermission.updated_by is, unlike every other "_by"/"_by_id" field in
  // the Base44 export, an EMAIL ADDRESS (the acting admin's email), not an
  // id -- discovered by a dry run FK violation. Our schema's updated_by is a
  // UUID FK, matching how our own backend writes it (req.user.id), so on
  // import we resolve the email against the users we're about to create
  // rather than treating it as another opaque id to remap.
  const emailToOldId = new Map();
  for (const u of usersById.values()) {
    if (u.email) emailToOldId.set(u.email.toLowerCase(), u.oldId);
  }
  function userRefByEmail(email) {
    if (!email) return null;
    const oldId = emailToOldId.get(email.toLowerCase());
    if (!oldId) {
      report.warnings.push(`UserPermission.updated_by email "${email}" matches no imported user -- set to NULL`);
      return null;
    }
    return newId(oldId);
  }

  const placeholderPasswordHash = await bcrypt.hash(crypto.randomUUID(), 10);

  const client = new pg.Client({ connectionString: args.databaseUrl, ssl: false });
  await client.connect();
  try {
    await client.query('BEGIN');

    // 1) users
    for (const u of usersById.values()) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, full_name, role, approved, account_status, must_change_password)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
        [newId(u.oldId), u.email, placeholderPasswordHash, u.full_name, u.role, u.approved, u.account_status]
      );
    }
    report.counts.users = usersById.size;

    // 2) team_members
    for (const tm of teamMembers) {
      await client.query(
        `INSERT INTO team_members (id, user_id, name, email, cost_rate, selling_rate, currency, role, location,
           holiday_calendar, max_hours_day, max_hours_week, max_hours_month, max_overtime_hours_week,
           created_by_id, created_date, updated_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [newId(tm.id), newId(tm.user_id), tm.name, nullIfEmpty(tm.email), toNum(tm.cost_rate), toNum(tm.selling_rate),
          tm.currency || 'AED', nullIfEmpty(tm.role), nullIfEmpty(tm.location), tm.holiday_calendar || 'none',
          toNum(tm.max_hours_day), toNum(tm.max_hours_week), toNum(tm.max_hours_month), toNum(tm.max_overtime_hours_week),
          userRef(tm.created_by_id), toTimestamp(tm.created_date), toTimestamp(tm.updated_date)]
      );
    }
    report.counts.team_members = teamMembers.length;

    // 3) projects
    for (const p of projects) {
      // Dedupe: several distinct Base44 test ids can collapse onto the same
      // shared "legacy data" account, which would otherwise list it twice in
      // one project's assigned_members.
      const assignedMembers = [...new Set(toJson(p.assigned_members, []).map((uid) => newId(uid)))];
      const memberAssignments = toJson(p.member_assignments, []).map((w) => ({ ...w, user_id: newId(w.user_id) }));
      await client.query(
        `INSERT INTO projects (id, name, client, description, reference_code, location, project_type, status,
           project_leader_id, assigned_members, member_assignments, active_stages, active_tasks, budget_currency,
           hourly_rate, markup_percentage, stage_budgets, stage_date_mode, stage_dates, exchange_rates,
           start_date, end_date, created_by_id, created_date, updated_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
        [newId(p.id), p.name, nullIfEmpty(p.client), nullIfEmpty(p.description), nullIfEmpty(p.reference_code),
          nullIfEmpty(p.location), nullIfEmpty(p.project_type), p.status || 'active', userRef(p.project_leader_id) || newId(p.project_leader_id),
          JSON.stringify(assignedMembers), JSON.stringify(memberAssignments), JSON.stringify(toJson(p.active_stages, [])),
          JSON.stringify(toJson(p.active_tasks, [])), p.budget_currency || 'AED', toNum(p.hourly_rate), toNum(p.markup_percentage) ?? 0,
          JSON.stringify(toJson(p.stage_budgets, [])), p.stage_date_mode || 'stage', JSON.stringify(toJson(p.stage_dates, [])),
          JSON.stringify(toJson(p.exchange_rates, { USD: 3.67, EUR: 4, GBP: 4.6 })), toDate(p.start_date), toDate(p.end_date),
          userRef(p.created_by_id), toTimestamp(p.created_date), toTimestamp(p.updated_date)]
      );
    }
    report.counts.projects = projects.length;

    // 4) task_assignments
    for (const ta of taskAssignments) {
      await client.query(
        `INSERT INTO task_assignments (id, project_id, assigned_to_user_id, assigned_by_user_id, task, stage,
           description, due_date, estimated_hours, status, created_by_id, created_date, updated_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [newId(ta.id), newId(ta.project_id), newId(ta.assigned_to_user_id), newId(ta.assigned_by_user_id), ta.task, ta.stage,
          nullIfEmpty(ta.description), toDate(ta.due_date), toNum(ta.estimated_hours), ta.status || 'open',
          userRef(ta.created_by_id), toTimestamp(ta.created_date), toTimestamp(ta.updated_date)]
      );
    }
    report.counts.task_assignments = taskAssignments.length;

    // 5) timesheet_entries
    for (const t of timesheets) {
      await client.query(
        `INSERT INTO timesheet_entries (id, user_id, entry_type, project_id, task, stage, hours, date, start_time,
           end_time, break_minutes, is_billable, is_timer_running, timer_started_at, notes, status, approved_by,
           approval_date, rejection_reason, week_start, assigned_task_id, created_by_id, created_date, updated_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
        [newId(t.id), newId(t.user_id), t.entry_type || 'work', t.project_id ? newId(t.project_id) : null,
          nullIfEmpty(t.task), nullIfEmpty(t.stage), toNum(t.hours), toDate(t.date), toTime(t.start_time), toTime(t.end_time),
          toNum(t.break_minutes) ?? 0, toBool(t.is_billable), toBool(t.is_timer_running), toTimestamp(t.timer_started_at),
          nullIfEmpty(t.notes), t.status || 'draft', t.approved_by ? userRef(t.approved_by) : null, toTimestamp(t.approval_date),
          nullIfEmpty(t.rejection_reason), toDate(t.week_start), t.assigned_task_id ? newId(t.assigned_task_id) : null,
          userRef(t.created_by_id), toTimestamp(t.created_date), toTimestamp(t.updated_date)]
      );
    }
    report.counts.timesheet_entries = timesheets.length;

    // 6) user_permissions
    for (const up of userPermissions) {
      await client.query(
        `INSERT INTO user_permissions (id, user_id, is_domain_admin, permissions, updated_by, updated_at,
           created_date, updated_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [newId(up.id), newId(up.user_id), toBool(up.is_domain_admin), JSON.stringify(toJson(up.permissions, {})),
          userRefByEmail(up.updated_by), toTimestamp(up.updated_at), toTimestamp(up.created_date), toTimestamp(up.updated_date)]
      );
    }
    report.counts.user_permissions = userPermissions.length;

    // 7) custom_options
    for (const co of customOptions) {
      await client.query(
        `INSERT INTO custom_options (id, list_type, value, label, numeric_value, sort_order, created_by_id,
           created_date, updated_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [newId(co.id), co.list_type, co.value, co.label, toNum(co.numeric_value) ?? 0, toNum(co.sort_order) ?? 0,
          userRef(co.created_by_id), toTimestamp(co.created_date), toTimestamp(co.updated_date)]
      );
    }
    report.counts.custom_options = customOptions.length;

    // 8) app_settings
    for (const as of appSettings) {
      await client.query(
        `INSERT INTO app_settings (id, key, value, created_by_id, created_date, updated_date)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [newId(as.id), as.key, JSON.stringify(toJson(as.value, {})), userRef(as.created_by_id),
          toTimestamp(as.created_date), toTimestamp(as.updated_date)]
      );
    }
    report.counts.app_settings = appSettings.length;

    // 9) pending_invites
    for (const pi of pendingInvites) {
      await client.query(
        `INSERT INTO pending_invites (id, email, role, created_by_id, created_date, updated_date)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [newId(pi.id), pi.email, pi.role || 'user', userRef(pi.created_by_id), toTimestamp(pi.created_date), toTimestamp(pi.updated_date)]
      );
    }
    report.counts.pending_invites = pendingInvites.length;

    // 10) assignment_conflicts / 11) account_status_audit -- empty in this
    // export, but handled generically so a later, non-empty export still works.
    for (const ac of assignmentConflicts) {
      await client.query(
        `INSERT INTO assignment_conflicts (id, project_id, user_id, work_date, resolution, resolved_by_email,
           resolved_at, created_by_id, created_date, updated_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [newId(ac.id), newId(ac.project_id), newId(ac.user_id), toDate(ac.work_date), ac.resolution,
          nullIfEmpty(ac.resolved_by_email), toTimestamp(ac.resolved_at), userRef(ac.created_by_id),
          toTimestamp(ac.created_date), toTimestamp(ac.updated_date)]
      );
    }
    report.counts.assignment_conflicts = assignmentConflicts.length;
    for (const au of accountStatusAudit) {
      await client.query(
        `INSERT INTO account_status_audit (id, target_user_id, target_name, target_email, action, reason,
           performed_by_id, performed_by_email, performed_at, created_date, updated_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [newId(au.id), newId(au.target_user_id), nullIfEmpty(au.target_name), nullIfEmpty(au.target_email), au.action,
          nullIfEmpty(au.reason), userRef(au.performed_by_id), nullIfEmpty(au.performed_by_email),
          toTimestamp(au.performed_at), toTimestamp(au.created_date), toTimestamp(au.updated_date)]
      );
    }
    report.counts.account_status_audit = accountStatusAudit.length;

    if (args.commit) {
      await client.query('COMMIT');
      report.committed = true;
    } else {
      await client.query('ROLLBACK');
      report.committed = false;
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nIMPORT FAILED -- transaction rolled back. Nothing was written.\n');
    throw err;
  } finally {
    await client.end();
  }

  // ---- Report ----
  console.log('=== StudioTime dry-run import report ===');
  console.log(args.commit ? '(COMMITTED -- this data is now in the target database)' : '(DRY RUN -- rolled back, nothing kept)');
  console.log();
  for (const [table, n] of Object.entries(report.counts)) console.log(`  ${table.padEnd(22)} ${n}`);
  console.log();
  console.log(`Users created: ${usersById.size} real account(s)`);
  console.log(`  from --users file: ${[...usersById.values()].filter((u) => u.source === 'users-file').length}`);
  console.log(`  from TeamMember (real email): ${[...usersById.values()].filter((u) => u.source === 'team-member').length}`);
  if (report.unresolvedUsers.size) {
    console.log(`  + 1 shared "legacy data" account (account_status=disabled, can't log in) standing in for`);
    console.log(`    ${report.unresolvedUsers.size} Base44 user id(s) referenced in Project/TimesheetEntry/`);
    console.log('    TaskAssignment/UserPermission with no TeamMember row and no --users file entry --');
    console.log('    presumed old test data. Review timesheet_entries and projects.assigned_members for this');
    console.log('    account before a real cutover and delete what you don\'t want to keep. Original ids:');
    for (const id of report.unresolvedUsers) console.log(`      ${id}`);
  }
  if (report.warnings.length) {
    console.log(`\nWarnings (${report.warnings.length}):`);
    for (const w of report.warnings) console.log(`  - ${w}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
