import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = '30d';

if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET is not set — using an insecure default. Set it in Replit Secrets before going live.');
}

export function signToken(user) {
  return jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    approved: row.approved,
    account_status: row.account_status,
    must_change_password: row.must_change_password,
    created_date: row.created_date,
    updated_date: row.updated_date,
  };
}

export async function findUserByEmail(email) {
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  return rows[0] || null;
}

export async function findUserById(id) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

// StudioTime has two platform roles, matching Base44's User entity: 'admin'
// (full read/write everywhere, subject to the app-level permission layer in
// server/lib/*) and 'user' (standard account). The much richer role model
// staff actually work under — junior_designer through top_management — lives
// on the team_members row, not here (see server/lib/* for how that's
// resolved into view/edit authority).
export async function createUser({ email, password, role = 'user', approved = false, full_name = null }) {
  const password_hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, role, approved, full_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [email, password_hash, role, approved, full_name]
  );
  return rows[0];
}

// Readable temporary password: avoids visually ambiguous characters (0/O,
// 1/l/I) since an admin will be reading this aloud or pasting it to relay to
// the affected user. No email provider involved anywhere in this flow.
const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function generateTempPassword(length = 12) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += TEMP_PASSWORD_CHARS[bytes[i] % TEMP_PASSWORD_CHARS.length];
  }
  return out;
}

// Admin-triggered reset: generates a temp password, stores its hash, and
// forces a change on next login. Callers (the dedicated admin route in
// server/routes/teamMembers.js or permissions.js) are responsible for
// authority-gating this first via server/lib/adminAuthority.js — this
// function itself does not check permissions.
export async function setTemporaryPassword(userId) {
  const tempPassword = generateTempPassword();
  const password_hash = await bcrypt.hash(tempPassword, 10);
  const { rows } = await query(
    `UPDATE users SET password_hash = $1, must_change_password = true, updated_date = now()
     WHERE id = $2 RETURNING *`,
    [password_hash, userId]
  );
  if (!rows[0]) throw new Error('User not found');
  return { user: rows[0], tempPassword };
}

// Express middleware: requires a valid bearer token, attaches req.user (full row).
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Not authenticated' });
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }
    const user = await findUserById(payload.sub);
    if (!user) return res.status(401).json({ message: 'Account no longer exists' });
    if (!user.approved) return res.status(403).json({ message: 'Account pending admin approval' });
    // account_status is also re-checked by server/lib/accountStatus.js at the
    // point of each business-logic action (Task #21); this is the first,
    // cheapest line of defense so a disabled account can't even load data.
    if (user.account_status === 'disabled') {
      return res.status(403).json({ message: 'This account has been disabled. Contact an administrator.' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    next();
  };
}

export function registerAuthRoutes(app) {
  app.post('/api/auth/register', async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });
      const existing = await findUserByEmail(email);
      if (existing) return res.status(409).json({ message: 'An account with that email already exists' });
      // First account ever created becomes an approved admin, so there is
      // always someone able to approve everyone else (matches the sibling
      // apps' bootstrap pattern; separate from the app-level Domain Admin
      // self-appointment in server/lib/adminAuthority.js).
      const { rows: countRows } = await query('SELECT count(*)::int AS n FROM users');
      const isFirstUser = countRows[0].n === 0;
      const user = await createUser({
        email,
        password,
        role: isFirstUser ? 'admin' : 'user',
        approved: isFirstUser,
      });
      if (isFirstUser) {
        return res.json({ token: signToken(user), user: toPublicUser(user) });
      }
      res.json({ pendingApproval: true, message: 'Account created. An admin needs to approve it before you can log in.' });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });
      const user = await findUserByEmail(email);
      if (!user) return res.status(401).json({ message: 'Invalid email or password' });
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ message: 'Invalid email or password' });
      if (!user.approved) return res.status(403).json({ message: 'Your account is pending admin approval' });
      if (user.account_status === 'disabled') {
        return res.status(403).json({ message: 'This account has been disabled. Contact an administrator.' });
      }
      // Login still succeeds on a temp password — the frontend checks
      // must_change_password on the returned user and routes to a forced
      // change-password screen before anything else is usable.
      res.json({ token: signToken(user), user: toPublicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json(toPublicUser(req.user));
  });

  // Self-service change-password: used both for a normal voluntary password
  // change and to clear must_change_password after an admin-issued temp
  // password. Requires knowing the current (possibly temporary) password.
  app.post('/api/auth/change-password', requireAuth, async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Current and new password are required' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ message: 'New password must be at least 8 characters' });
      }
      const ok = await bcrypt.compare(currentPassword, req.user.password_hash);
      if (!ok) return res.status(401).json({ message: 'Current password is incorrect' });
      const password_hash = await bcrypt.hash(newPassword, 10);
      const { rows } = await query(
        `UPDATE users SET password_hash = $1, must_change_password = false, updated_date = now()
         WHERE id = $2 RETURNING *`,
        [password_hash, req.user.id]
      );
      res.json(toPublicUser(rows[0]));
    } catch (err) {
      next(err);
    }
  });
}
