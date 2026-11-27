import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { Loader2, Plus, Trash2 } from 'lucide-react';

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
const today = () => new Date().toISOString().slice(0, 10);

const STATUS_VARIANT = { open: 'secondary', in_progress: 'default', done: 'secondary' };

const emptyForm = { project_id: '', assigned_to_user_id: '', task: '', stage: '', description: '', due_date: '', estimated_hours: '' };

export default function Planning() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(addDays(today(), 28));
  const [plan, setPlan] = useState({ projects: [], roster: [], hours: [] });
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [planResult, projectRows] = await Promise.all([
        base44.planning.resourcePlan(from, to),
        base44.projects.list(),
      ]);
      setPlan(planResult);
      setProjects(projectRows || []);
      try {
        setTasks(await base44.entities.TaskAssignment.list('-created_date'));
      } catch { setTasks([]); }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not load planning data', description: err.message });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  const memberName = (userId) => plan.roster.find((m) => m.user_id === userId)?.name || '—';
  const projectName = (id) => plan.projects.find((p) => p.id === id)?.name || projects.find((p) => p.id === id)?.name || '—';

  const hoursFor = (projectId, userId) => plan.hours
    .filter((h) => h.project_id === projectId && h.user_id === userId)
    .reduce((sum, h) => sum + (Number(h.hours) || 0), 0);

  const selectedProject = projects.find((p) => p.id === form.project_id);
  const assignableMembers = useMemo(() => {
    if (!selectedProject) return [];
    const assigned = Array.isArray(selectedProject.assigned_members) ? selectedProject.assigned_members : [];
    return plan.roster.filter((m) => assigned.includes(m.user_id));
  }, [selectedProject, plan.roster]);

  const openAssign = () => { setForm(emptyForm); setDialogOpen(true); };

  const handleAssign = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await base44.planning.assignTask({
        project_id: form.project_id, assigned_to_user_id: form.assigned_to_user_id,
        task: form.task, stage: form.stage, description: form.description || null,
        due_date: form.due_date || null, estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : null,
      });
      setDialogOpen(false);
      toast({ title: 'Task assigned' });
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not assign task', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (taskId, status) => {
    try {
      await base44.planning.updateTaskStatus(taskId, status);
      toast({ title: 'Task updated' });
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not update task', description: err.message });
    }
  };
  const deleteTask = async (taskId) => {
    try {
      await base44.planning.deleteTask(taskId);
      toast({ title: 'Task removed' });
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not remove task', description: err.message });
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Planning</h1>
          <p className="text-slate-500 text-sm mt-1">Resource allocation and task assignments.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openAssign}><Plus className="w-4 h-4 mr-2" /> Assign task</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Assign a task</DialogTitle></DialogHeader>
            <form onSubmit={handleAssign} className="space-y-4">
              <div className="space-y-2">
                <Label>Project</Label>
                <Select value={form.project_id} onValueChange={(v) => setForm((f) => ({ ...f, project_id: v, assigned_to_user_id: '', task: '', stage: '' }))} required>
                  <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Assign to</Label>
                <Select value={form.assigned_to_user_id} onValueChange={(v) => setForm((f) => ({ ...f, assigned_to_user_id: v }))} required>
                  <SelectTrigger><SelectValue placeholder="Select a team member" /></SelectTrigger>
                  <SelectContent>
                    {assignableMembers.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Stage</Label>
                  <Select value={form.stage} onValueChange={(v) => setForm((f) => ({ ...f, stage: v }))} required>
                    <SelectTrigger><SelectValue placeholder="Stage" /></SelectTrigger>
                    <SelectContent>
                      {(selectedProject?.active_stages || []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Task</Label>
                  <Select value={form.task} onValueChange={(v) => setForm((f) => ({ ...f, task: v }))} required>
                    <SelectTrigger><SelectValue placeholder="Task" /></SelectTrigger>
                    <SelectContent>
                      {(selectedProject?.active_tasks || []).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Due date</Label>
                  <Input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Estimated hours</Label>
                  <Input type="number" step="0.25" value={form.estimated_hours} onChange={(e) => setForm((f) => ({ ...f, estimated_hours: e.target.value }))} />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Assign task
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="resource-plan">
        <TabsList>
          <TabsTrigger value="resource-plan">Resource plan</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>

        <TabsContent value="resource-plan" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : (
            <div className="space-y-4">
              {plan.projects.map((p) => (
                <Card key={p.id}>
                  <CardHeader><CardTitle className="text-base">{p.name}</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Member</TableHead>
                          <TableHead>Window</TableHead>
                          <TableHead>Hours logged in range</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {p.allocations.map((a) => (
                          <TableRow key={a.user_id}>
                            <TableCell className="font-medium">{memberName(a.user_id)}</TableCell>
                            <TableCell className="text-slate-500 text-xs">
                              {a.windows.map((w, i) => (
                                <div key={i}>{w.from} – {w.to || 'ongoing'}</div>
                              ))}
                              {a.windows.length === 0 && '—'}
                            </TableCell>
                            <TableCell>{hoursFor(p.id, a.user_id).toFixed(2)}h</TableCell>
                          </TableRow>
                        ))}
                        {p.allocations.length === 0 && (
                          <TableRow><TableCell colSpan={3} className="text-center text-slate-400 py-4">No one assigned.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}
              {plan.projects.length === 0 && <p className="text-slate-400 text-center py-8">No visible projects.</p>}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Assigned to</TableHead>
                    <TableHead>Stage / Task</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{projectName(t.project_id)}</TableCell>
                      <TableCell>{memberName(t.assigned_to_user_id)}</TableCell>
                      <TableCell>{[t.stage, t.task].filter(Boolean).join(' / ')}</TableCell>
                      <TableCell>{t.due_date || '—'}</TableCell>
                      <TableCell>
                        <Select value={t.status} onValueChange={(v) => updateStatus(t.id, v)}>
                          <SelectTrigger className="w-32">
                            <Badge variant={STATUS_VARIANT[t.status] || 'secondary'} className="capitalize">{t.status.replace('_', ' ')}</Badge>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="open">Open</SelectItem>
                            <SelectItem value="in_progress">In progress</SelectItem>
                            <SelectItem value="done">Done</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => deleteTask(t.id)}><Trash2 className="w-4 h-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {tasks.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-slate-400 py-8">No tasks assigned yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
