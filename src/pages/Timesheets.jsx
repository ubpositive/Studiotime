import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight, Plus, Loader2, Undo2, Lock, Trash2 } from 'lucide-react';

function mondayOf(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() + n);
  return date.toISOString().slice(0, 10);
}
function weekDays(weekStart) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

const STATUS_VARIANT = {
  draft: 'secondary',
  submitted: 'default',
  approved: 'default',
  rejected: 'destructive',
};

const emptyForm = {
  entry_type: 'work', project_id: '', task: '', stage: '', hours: '', date: '', notes: '',
};

export default function Timesheets() {
  const { user } = useAuth();
  const [weekStart, setWeekStart] = useState(mondayOf(new Date().toISOString().slice(0, 10)));
  const [entries, setEntries] = useState([]);
  const [projects, setProjects] = useState([]);
  const [stageOptions, setStageOptions] = useState([]);
  const [taskOptions, setTaskOptions] = useState([]);
  const [breakTypeOptions, setBreakTypeOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [entryRows, projectRows, stages, tasks, breaks] = await Promise.all([
        base44.entities.TimesheetEntry.filter({ week_start: weekStart }),
        base44.projects.list(),
        base44.entities.CustomOption.filter({ list_type: 'stages' }, 'sort_order'),
        base44.entities.CustomOption.filter({ list_type: 'tasks' }, 'sort_order'),
        base44.entities.CustomOption.filter({ list_type: 'break_types' }, 'sort_order'),
      ]);
      setEntries((entryRows || []).filter((e) => e.user_id === user?.id));
      setProjects(projectRows || []);
      setStageOptions(stages || []);
      setTaskOptions(tasks || []);
      setBreakTypeOptions(breaks || []);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not load timesheet', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [weekStart]);

  const byDate = useMemo(() => {
    const map = {};
    for (const d of weekDays(weekStart)) map[d] = [];
    for (const e of entries) { if (map[e.date]) map[e.date].push(e); }
    return map;
  }, [entries, weekStart]);

  const weekTotal = entries.reduce((sum, e) => sum + (Number(e.hours) || 0), 0);

  const openNewEntry = (date) => {
    setForm({ ...emptyForm, date: date || weekStart });
    setDialogOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await base44.timesheets.create({
        entry_type: form.entry_type,
        project_id: form.entry_type === 'work' ? (form.project_id || null) : null,
        task: form.entry_type === 'work' ? (form.task || null) : null,
        stage: form.entry_type === 'work' ? (form.stage || null) : null,
        hours: form.hours ? Number(form.hours) : null,
        date: form.date,
        week_start: mondayOf(form.date),
        notes: form.notes || null,
      });
      setDialogOpen(false);
      toast({ title: 'Entry added' });
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not add entry', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const submitEntry = async (entry) => {
    try {
      await base44.timesheets.update(entry.id, { status: 'submitted' });
      toast({ title: 'Submitted for approval' });
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not submit', description: err.message });
    }
  };
  const recallEntry = async (entry) => {
    try {
      await base44.timesheets.recall(entry.id);
      toast({ title: 'Recalled to draft' });
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not recall', description: err.message });
    }
  };
  const deleteEntry = async (entry) => {
    try {
      await base44.timesheets.delete(entry.id);
      toast({ title: 'Entry deleted' });
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not delete', description: err.message });
    }
  };

  const projectName = (id) => projects.find((p) => p.id === id)?.name || '—';

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">My Timesheet</h1>
          <p className="text-slate-500 text-sm mt-1">Log, submit, and track your hours week by week.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => openNewEntry(weekStart)}>
              <Plus className="w-4 h-4 mr-2" /> Add entry
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add time entry</DialogTitle></DialogHeader>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={form.entry_type} onValueChange={(v) => setForm((f) => ({ ...f, entry_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="work">Work</SelectItem>
                      {breakTypeOptions.map((o) => (
                        <SelectItem key={o.id} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="date">Date</Label>
                  <Input id="date" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required />
                </div>
              </div>
              {form.entry_type === 'work' && (
                <>
                  <div className="space-y-2">
                    <Label>Project</Label>
                    <Select value={form.project_id} onValueChange={(v) => setForm((f) => ({ ...f, project_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
                      <SelectContent>
                        {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Stage</Label>
                      <Select value={form.stage} onValueChange={(v) => setForm((f) => ({ ...f, stage: v }))}>
                        <SelectTrigger><SelectValue placeholder="Stage" /></SelectTrigger>
                        <SelectContent>
                          {stageOptions.map((o) => <SelectItem key={o.id} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Task</Label>
                      <Select value={form.task} onValueChange={(v) => setForm((f) => ({ ...f, task: v }))}>
                        <SelectTrigger><SelectValue placeholder="Task" /></SelectTrigger>
                        <SelectContent>
                          {taskOptions.map((o) => <SelectItem key={o.id} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label htmlFor="hours">Hours</Label>
                <Input id="hours" type="number" step="0.25" min="0" value={form.hours} onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Save as draft
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="w-4 h-4" /></Button>
        <span className="text-sm font-medium text-slate-700">
          Week of {weekStart} – {addDays(weekStart, 6)}
        </span>
        <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="w-4 h-4" /></Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Entries this week</CardTitle>
          <span className="text-sm text-slate-500">Total: <span className="font-semibold text-slate-900">{weekTotal.toFixed(2)}h</span></span>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Stage / Task</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {weekDays(weekStart).flatMap((d) => (byDate[d] || []).map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">{entry.date}</TableCell>
                    <TableCell className="capitalize">{entry.entry_type}</TableCell>
                    <TableCell>{entry.entry_type === 'work' ? projectName(entry.project_id) : '—'}</TableCell>
                    <TableCell>{entry.entry_type === 'work' ? [entry.stage, entry.task].filter(Boolean).join(' / ') || '—' : '—'}</TableCell>
                    <TableCell>{entry.hours ?? '—'}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[entry.status] || 'secondary'} className="capitalize">{entry.status}</Badge></TableCell>
                    <TableCell className="text-right space-x-1">
                      {entry.status === 'draft' && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => submitEntry(entry)}>Submit</Button>
                          <Button size="sm" variant="ghost" onClick={() => deleteEntry(entry)}><Trash2 className="w-4 h-4" /></Button>
                        </>
                      )}
                      {entry.status === 'submitted' && (
                        <Button size="sm" variant="outline" onClick={() => recallEntry(entry)}>
                          <Undo2 className="w-4 h-4 mr-1" /> Recall
                        </Button>
                      )}
                      {entry.status === 'approved' && (
                        <span className="inline-flex items-center text-xs text-slate-400"><Lock className="w-3 h-3 mr-1" /> Locked</span>
                      )}
                      {entry.status === 'rejected' && (
                        <span className="text-xs text-red-600" title={entry.rejection_reason}>{entry.rejection_reason}</span>
                      )}
                    </TableCell>
                  </TableRow>
                )))}
                {entries.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-slate-400 py-8">No entries yet this week.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
