import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isAdmin as checkIsAdmin } from '@/lib/permissions';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogAction, AlertDialogCancel, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Loader2, ArrowLeft, Trash2, Save } from 'lucide-react';

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, teamMember } = useAuth();
  const canSetFinancials = checkIsAdmin(user) || teamMember?.role === 'top_management';

  const [project, setProject] = useState(null);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [p, rosterResult] = await Promise.all([
        base44.entities.Project.get(id),
        base44.teamMembers.roster(),
      ]);
      setProject(p);
      setRoster(rosterResult.roster || []);
      setForm({
        name: p.name || '', client: p.client || '', description: p.description || '',
        reference_code: p.reference_code || '', location: p.location || '', project_type: p.project_type || '',
        status: p.status || 'active', project_leader_id: p.project_leader_id || '',
        assigned_members: Array.isArray(p.assigned_members) ? p.assigned_members : [],
        active_stages: (p.active_stages || []).join(', '),
        active_tasks: (p.active_tasks || []).join(', '),
        budget_currency: p.budget_currency || 'AED',
        hourly_rate: p.hourly_rate ?? '', markup_percentage: p.markup_percentage ?? '',
        start_date: p.start_date || '', end_date: p.end_date || '',
      });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not load project', description: err.message });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const leaderName = (uid) => roster.find((m) => m.user_id === uid)?.name || '—';
  const canEdit = checkIsAdmin(user) || project?.project_leader_id === user?.id || project?.created_by_id === user?.id
    || ['design_head', 'design_director', 'top_management'].includes(teamMember?.role);

  const toggleMember = (userId) => {
    setForm((f) => ({
      ...f,
      assigned_members: f.assigned_members.includes(userId)
        ? f.assigned_members.filter((x) => x !== userId)
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
        payload.hourly_rate = form.hourly_rate === '' ? null : Number(form.hourly_rate);
        payload.markup_percentage = form.markup_percentage === '' ? 0 : Number(form.markup_percentage);
      }
      await base44.projects.update(id, payload);
      toast({ title: 'Project saved' });
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not save project', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await base44.projects.delete(id);
      toast({ title: 'Project deleted' });
      navigate('/projects');
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not delete project', description: err.message });
    }
  };

  if (loading || !form) {
    return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate('/projects')}>
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to projects
      </Button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{project.name}</h1>
          <p className="text-slate-500 text-sm mt-1">Led by {leaderName(project.project_leader_id)}</p>
        </div>
        <Badge className="capitalize">{(project.status || '').replace('_', ' ')}</Badge>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Project details</CardTitle></CardHeader>
        <CardContent>
          <fieldset disabled={!canEdit} className="space-y-4 disabled:opacity-60">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Client</Label>
                <Input value={form.client} onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Reference</Label>
                <Input value={form.reference_code} onChange={(e) => setForm((f) => ({ ...f, reference_code: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Input value={form.project_type} onChange={(e) => setForm((f) => ({ ...f, project_type: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Project leader</Label>
                <Select value={form.project_leader_id} onValueChange={(v) => setForm((f) => ({ ...f, project_leader_id: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
                <Label>Active stages (comma separated)</Label>
                <Input value={form.active_stages} onChange={(e) => setForm((f) => ({ ...f, active_stages: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Active tasks (comma separated)</Label>
                <Input value={form.active_tasks} onChange={(e) => setForm((f) => ({ ...f, active_tasks: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Assigned members</Label>
              <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto border rounded-md p-3">
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
                <Label>Start date</Label>
                <Input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>End date</Label>
                <Input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
            {canSetFinancials && (
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Hourly rate</Label>
                  <Input type="number" step="0.01" value={form.hourly_rate} onChange={(e) => setForm((f) => ({ ...f, hourly_rate: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Markup %</Label>
                  <Input type="number" step="0.01" value={form.markup_percentage} onChange={(e) => setForm((f) => ({ ...f, markup_percentage: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Input value={form.budget_currency} onChange={(e) => setForm((f) => ({ ...f, budget_currency: e.target.value }))} />
                </div>
              </div>
            )}
          </fieldset>

          {canEdit && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="text-red-600 hover:text-red-700">
                    <Trash2 className="w-4 h-4 mr-2" /> Delete project
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {project.name}?</AlertDialogTitle>
                    <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save changes
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
