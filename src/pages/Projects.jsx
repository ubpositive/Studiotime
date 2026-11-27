import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isAdmin as checkIsAdmin, isSupervisorOrAbove } from '@/lib/permissions';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Plus, MapPin, User as UserIcon } from 'lucide-react';

const STATUS_VARIANT = { active: 'default', on_hold: 'secondary', completed: 'secondary', cancelled: 'destructive' };

const emptyForm = {
  name: '', client: '', description: '', reference_code: '', location: '', project_type: '', status: 'active',
  project_leader_id: '', assigned_members: [], active_stages: '', active_tasks: '',
  budget_currency: 'AED', hourly_rate: '', markup_percentage: '', start_date: '', end_date: '',
};

export default function Projects() {
  const { user, teamMember } = useAuth();
  const canAdd = isSupervisorOrAbove({ user, teamMember }) || checkIsAdmin(user);
  const canSetFinancials = checkIsAdmin(user) || teamMember?.role === 'top_management';

  const [projects, setProjects] = useState([]);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [projectRows, rosterResult] = await Promise.all([
        base44.projects.list(),
        base44.teamMembers.roster(),
      ]);
      setProjects(projectRows || []);
      setRoster(rosterResult.roster || []);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not load projects', description: err.message });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const leaderName = (id) => roster.find((m) => m.user_id === id)?.name || '—';

  const openCreate = () => { setForm(emptyForm); setDialogOpen(true); };

  const toggleMember = (userId) => {
    setForm((f) => ({
      ...f,
      assigned_members: f.assigned_members.includes(userId)
        ? f.assigned_members.filter((id) => id !== userId)
        : [...f.assigned_members, userId],
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name, client: form.client || null, description: form.description || null,
        reference_code: form.reference_code || null, location: form.location || null,
        project_type: form.project_type || null, status: form.status,
        project_leader_id: form.project_leader_id,
        assigned_members: form.assigned_members,
        active_stages: form.active_stages.split(',').map((s) => s.trim()).filter(Boolean),
        active_tasks: form.active_tasks.split(',').map((s) => s.trim()).filter(Boolean),
        budget_currency: form.budget_currency,
        start_date: form.start_date || null, end_date: form.end_date || null,
      };
      if (canSetFinancials) {
        if (form.hourly_rate !== '') payload.hourly_rate = Number(form.hourly_rate);
        if (form.markup_percentage !== '') payload.markup_percentage = Number(form.markup_percentage);
      }
      await base44.projects.create(payload);
      setDialogOpen(false);
      toast({ title: 'Project created' });
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not create project', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Projects</h1>
          <p className="text-slate-500 text-sm mt-1">Everything you lead, created, or are assigned to.</p>
        </div>
        {canAdd && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> New project</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
              <form onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client">Client</Label>
                    <Input id="client" value={form.client} onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="reference_code">Reference</Label>
                    <Input id="reference_code" value={form.reference_code} onChange={(e) => setForm((f) => ({ ...f, reference_code: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="location">Location</Label>
                    <Input id="location" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="project_type">Type</Label>
                    <Input id="project_type" value={form.project_type} onChange={(e) => setForm((f) => ({ ...f, project_type: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Project leader</Label>
                    <Select value={form.project_leader_id} onValueChange={(v) => setForm((f) => ({ ...f, project_leader_id: v }))} required>
                      <SelectTrigger><SelectValue placeholder="Select a leader" /></SelectTrigger>
                      <SelectContent>
                        {roster.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="on_hold">On hold</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="active_stages">Active stages (comma separated)</Label>
                    <Input id="active_stages" value={form.active_stages} onChange={(e) => setForm((f) => ({ ...f, active_stages: e.target.value }))} placeholder="concept, design_development, construction" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="active_tasks">Active tasks (comma separated)</Label>
                    <Input id="active_tasks" value={form.active_tasks} onChange={(e) => setForm((f) => ({ ...f, active_tasks: e.target.value }))} placeholder="drawings, coordination" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Assigned members</Label>
                  <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto border rounded-md p-3">
                    {roster.map((m) => (
                      <label key={m.user_id} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={form.assigned_members.includes(m.user_id)} onCheckedChange={() => toggleMember(m.user_id)} />
                        {m.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="start_date">Start date</Label>
                    <Input id="start_date" type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="end_date">End date</Label>
                    <Input id="end_date" type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
                  </div>
                </div>
                {canSetFinancials && (
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="hourly_rate">Hourly rate</Label>
                      <Input id="hourly_rate" type="number" step="0.01" value={form.hourly_rate} onChange={(e) => setForm((f) => ({ ...f, hourly_rate: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="markup_percentage">Markup %</Label>
                      <Input id="markup_percentage" type="number" step="0.01" value={form.markup_percentage} onChange={(e) => setForm((f) => ({ ...f, markup_percentage: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="budget_currency">Currency</Label>
                      <Input id="budget_currency" value={form.budget_currency} onChange={(e) => setForm((f) => ({ ...f, budget_currency: e.target.value }))} />
                    </div>
                  </div>
                )}
                <DialogFooter>
                  <Button type="submit" disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Create project
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`}>
              <Card className="h-full hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <Badge variant={STATUS_VARIANT[p.status] || 'secondary'} className="capitalize">{(p.status || '').replace('_', ' ')}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-500">
                  {p.client && <div>{p.client}</div>}
                  {p.location && <div className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {p.location}</div>}
                  <div className="flex items-center gap-1"><UserIcon className="w-3 h-3" /> {leaderName(p.project_leader_id)}</div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {projects.length === 0 && (
            <p className="text-slate-400 col-span-full text-center py-12">No projects yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
