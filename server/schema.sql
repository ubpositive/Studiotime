-- StudioTime schema
-- Rebuilt from the live Base44 app's entity schemas (see studiotime_discovery_notes.md).
-- Role model: platform role user/admin (users.role), plus an app-level TeamMember role
-- hierarchy (junior_designer < designer/bim_modeller/cad_technician < project_leader <
-- design_head < design_director < top_management) enforced in server/lib + routes, not
-- in the database.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  approved BOOLEAN NOT NULL DEFAULT false,
  -- Account status (Base44 User entity extension). Field-level RLS in Base44 restricted
  -- these to admin-only updates; enforced the same way in server/lib/accountStatus.js.
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active','disabled')),
  disabled_at TIMESTAMPTZ,
  disabled_reason TEXT,
  reenabled_at TIMESTAMPTZ,
  -- Set true whenever an admin issues a temporary password (see server/auth.js
  -- setTemporaryPassword); the user must set a real password before using the app
  -- further. No email provider involved — the temp password is shown to the admin
  -- to relay directly.
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One TeamMember row per app-level staff profile. Not every `users` row has one (an
-- invited/registered account with no defined TeamMember role yet has no rates or caps).
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  cost_rate NUMERIC NOT NULL,
  selling_rate NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AED' CHECK (currency IN ('AED','USD','EUR','GBP')),
  -- Free-text role, validated server-side against the custom_options 'team_roles' list
  -- (DEFAULT_ROLE_VALUES: junior_designer, designer, senior_designer, bim_modeller,
  -- cad_technician, project_leader, design_head, design_director, top_management).
  role TEXT,
  location TEXT,
  -- Holiday calendar is one of ~39 country codes in Base44; validated server-side rather
  -- than DB-enforced here so the allowed-list can be extended without a migration.
  holiday_calendar TEXT NOT NULL DEFAULT 'none',
  max_hours_day NUMERIC NOT NULL DEFAULT 8,
  max_hours_week NUMERIC NOT NULL DEFAULT 40,
  max_hours_month NUMERIC NOT NULL DEFAULT 160,
  max_overtime_hours_week NUMERIC NOT NULL DEFAULT 10,
  created_by_id UUID REFERENCES users(id),
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pending_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_by_id UUID REFERENCES users(id),
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  client TEXT,
  description TEXT,
  reference_code TEXT,
  location TEXT,
  project_type TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','completed','archived')),
  project_leader_id UUID NOT NULL REFERENCES users(id),
  -- Current member list, kept in sync with member_assignments (see manageProject /
  -- reassignMembers logic ported into server/routes/projects.js + planning.js).
  assigned_members JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Server-derived history of {user_id, from, to} windows. `to` is set only when a
  -- member is removed; never client-supplied directly.
  member_assignments JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_stages JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_tasks JSONB NOT NULL DEFAULT '[]'::jsonb,
  budget_currency TEXT NOT NULL DEFAULT 'AED' CHECK (budget_currency IN ('AED','USD','EUR','GBP')),
  hourly_rate NUMERIC,
  markup_percentage NUMERIC NOT NULL DEFAULT 0,
  -- [{stage, task, budgeted_hours, budgeted_cost}]
  stage_budgets JSONB NOT NULL DEFAULT '[]'::jsonb,
  stage_date_mode TEXT NOT NULL DEFAULT 'stage' CHECK (stage_date_mode IN ('stage','stage_task')),
  -- [{stage, task, expected_start, expected_end}]
  stage_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- {"USD":3.67,"EUR":4,"GBP":4.6} — all costs stored converted to AED base currency.
  exchange_rates JSONB NOT NULL DEFAULT '{"USD":3.67,"EUR":4,"GBP":4.6}'::jsonb,
  start_date DATE,
  end_date DATE,
  created_by_id UUID REFERENCES users(id),
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assigned_to_user_id UUID NOT NULL REFERENCES users(id),
  assigned_by_user_id UUID NOT NULL REFERENCES users(id),
  task TEXT NOT NULL,
  stage TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  estimated_hours NUMERIC,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
  created_by_id UUID REFERENCES users(id),
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timesheet_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  entry_type TEXT NOT NULL DEFAULT 'work',
  project_id UUID REFERENCES projects(id),
  task TEXT,
  stage TEXT,
  hours NUMERIC,
  date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  break_minutes NUMERIC NOT NULL DEFAULT 0,
  -- A non-'work' entry (break/leave) is always forced non-billable server-side
  -- regardless of client input (see server/routes/timesheets.js).
  is_billable BOOLEAN NOT NULL DEFAULT true,
  is_timer_running BOOLEAN NOT NULL DEFAULT false,
  timer_started_at TIMESTAMPTZ,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  approved_by UUID REFERENCES users(id),
  approval_date TIMESTAMPTZ,
  rejection_reason TEXT,
  week_start DATE NOT NULL,
  assigned_task_id UUID REFERENCES task_assignments(id),
  created_by_id UUID REFERENCES users(id),
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  is_domain_admin BOOLEAN NOT NULL DEFAULT false,
  -- Shape (PERMISSION_SHAPE): { projects:{view_all,add,edit,delete},
  -- project_members:{add,edit,delete}, timesheets:{approve,edit_approved},
  -- resource_planning:{view_team,view_all}, team:{view,add,edit,delete},
  -- budget:{view,edit}, cost_rates:{view,edit}, actual_cost:{view,edit},
  -- billed:{view,edit}, cost_settings:{view,edit}, setup_hours:{edit} }
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assignment_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  work_date DATE NOT NULL,
  resolution TEXT NOT NULL CHECK (resolution IN ('assigned','dismissed')),
  resolved_by_email TEXT,
  resolved_at TIMESTAMPTZ,
  created_by_id UUID REFERENCES users(id),
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_status_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id UUID NOT NULL REFERENCES users(id),
  target_name TEXT,
  target_email TEXT,
  action TEXT NOT NULL CHECK (action IN ('disabled','reenabled')),
  reason TEXT,
  performed_by_id UUID NOT NULL REFERENCES users(id),
  performed_by_email TEXT,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Generic admin-configurable lists backing stages/tasks/break types/team roles/hourly
-- rate presets. Project.active_stages / active_tasks reference these by `value`.
CREATE TABLE IF NOT EXISTS custom_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_type TEXT NOT NULL CHECK (list_type IN ('stages','tasks','break_types','team_roles','hourly_rates')),
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  numeric_value NUMERIC NOT NULL DEFAULT 0,
  sort_order NUMERIC NOT NULL DEFAULT 0,
  created_by_id UUID REFERENCES users(id),
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Generic global key/value settings store. Known key: 'admin_delegation' — the three
-- delegated-authority booleans (view_permissions/edit_permissions/reset_passwords).
CREATE TABLE IF NOT EXISTS app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_id UUID REFERENCES users(id),
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_invites_email ON pending_invites(email);
CREATE INDEX IF NOT EXISTS idx_projects_leader ON projects(project_leader_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_project ON task_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_assigned_to ON task_assignments(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_assigned_by ON task_assignments(assigned_by_user_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_user ON timesheet_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_project ON timesheet_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_week_start ON timesheet_entries(week_start);
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_status ON timesheet_entries(status);
CREATE INDEX IF NOT EXISTS idx_assignment_conflicts_project ON assignment_conflicts(project_id);
CREATE INDEX IF NOT EXISTS idx_assignment_conflicts_user ON assignment_conflicts(user_id);
CREATE INDEX IF NOT EXISTS idx_account_status_audit_target ON account_status_audit(target_user_id);
CREATE INDEX IF NOT EXISTS idx_custom_options_list_type ON custom_options(list_type);
CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings(key);
