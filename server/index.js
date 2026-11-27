import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureSchema } from './db.js';
import { registerAuthRoutes } from './auth.js';
import { teamMembersRouter } from './routes/teamMembers.js';
import { approvalsRouter } from './routes/approvals.js';
import { timesheetsRouter } from './routes/timesheets.js';
import { projectsRouter } from './routes/projects.js';
import { planningRouter } from './routes/planning.js';
import { permissionsRouter } from './routes/permissions.js';
import { optionsRouter } from './routes/options.js';
import { makeEntityRouter, registerChangeFeedRoute, ENTITY_CONFIGS } from './entities.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());

// Auth routes register their own absolute /api/auth/* paths.
registerAuthRoutes(app);

// Dedicated business-logic routes (Task #23) — each owns the writes for the
// entities it covers; server/entities.js's generic CRUD is wired below with
// those entities' canCreate/canUpdate/canDelete hard-wired to false, so
// mounting order between these and the entity routers doesn't matter for
// write safety. It DOES matter for registerChangeFeedRoute, below.
app.use('/api/team-members', teamMembersRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/timesheets', timesheetsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/planning', planningRouter);
app.use('/api/permissions', permissionsRouter);
app.use('/api/options', optionsRouter);

// IMPORTANT (found the hard way while smoke-testing server/entities.js,
// Task #22): registerChangeFeedRoute's GET /api/entities/:name/changed-since
// must be registered BEFORE the generic entity routers below. An entity
// router's own GET /:id would otherwise match first and try to parse the
// literal string "changed-since" as a UUID, throwing a Postgres error.
registerChangeFeedRoute(app);

for (const name of Object.keys(ENTITY_CONFIGS)) {
  app.use(`/api/entities/${name}`, makeEntityRouter(name));
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve the built frontend (npm run build outputs to dist/) and let React
// Router handle client-side routes.
const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(distDir, 'index.html'));
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ message: 'Server error' });
});

const PORT = process.env.PORT || 3000;

ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`StudioTime server listening on :${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to prepare database schema:', err);
    process.exit(1);
  });
