import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import {
  ROLE_LABELS, assignableRoles, isSupervisorOrAbove, isAdmin as checkIsAdmin,
} from '@/lib/permissions';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Loader2, Plus, Pencil, Trash2, UserCheck } from 'lucide-react';

const emptyForm = {
  user_id: '', name: '', email: '', role: '', location: '', holiday_calendar: 'none',
  max_hours_day: 8, max_hours_week: 40, max_hours_month: 160, max_overtime_hours_week: 10,
  cost_rate: '', selling_rate: '', currency: 'AED',
};

export default function Team() {
  const { user, teamMember } = useAuth();
  const canManage = isSupervisorOrAbove({ user, teamMember });
  const admin = checkIsAdmin(user);

  const [roster, setRoster] = useState([]);
  const [platformUsers, setPlatformUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const rosterResult = await base44.teamMembers.roster();
      setRoster(rosterResult.roster || []);
      if (canManage) {
        try {
          const users = await base44.teamMembers.users();
          setPlatformUsers(users || []);
        } catch { setPlatformUsers([]); }
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not load team', description: err.message });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const roles = assignableRoles({ actingUser: user, actingTeamMember: teamMember });
  const usersWithoutTeamMember = useMemo(() => {
    const rosterUserIds = new Set(roster.map((m) => m.user_id));
    return platformUsers.filter((u) => !rosterUserIds.has(u.id) && u.id);
  }, [platformUsers, roster]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };
  const openEdit = (m) => {
    setEditingId(m.id);
    setForm({
      user_id: m.user_id, name: m.name || '', email: m.email || '', role: m.role || '',
      location: m.location || '', holiday_calendar: m.holiday_calendar || 'none',
      max_hours_day: m.max_hours_day ?? 8, max_hours_week: m.max_hours_week ?? 40,
      max_hours_month: m.max_hours_month ?? 160, max_overtime_hours_week: m.max_overtime_hours_week ?? 10,
      cost_rate: m.cost_rate ?? '', selling_rate: m.selling_rate ?? '', currency: m.currency || 'AED',
    });
    setDialogOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name, email: form.email || null, role: form.role || null,
        location: form.location || null, holiday_calendar: form.holiday_calendar,
        max_hours_day: Number(form.max_hours_day), max_hours_week: Number(form.max_hours_week),
        max_hours_month: Number(form.max_hours_month), max_overtime_hours_week: Number(form.max_overtime_hours_week),
      };
      if (form.cost_rate !== '') payload.cost_rate = Number(form.cost_rate);
      if (form.selling_rate !== '') payload.selling_rate = Number(form.selling_rate);
      if (form.currency) payload.currency = form.currency;
      if (editingId) {
        await base44.teamMembers.update(editingId, payload);
      } else {
        await base44.teamMembers.create({ ...payload, user_id: form.user_id });
      }
      setDialogOpen(false);
      toast({ title: editingId ? 'Team member updated' : 'Team member added' });
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not save', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await base44.teamMembers.delete(deleteTarget.id);
      toast({ title: 'Team member removed' });
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not remove', description: err.message });
    }
  };

  const approveUser = async (u) => {
    try {
      await base44.teamMembers.updateUser(u.id, { approved: true });
      toast({ title: `${u.full_name} approved` });
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not approve', description: err.message });
    }
  };
  const changePlatformRole = async (u, role) => {
    try {
      await base44.teamMembers.updateUser(u.id, { role });
      toast({ title: 'Platform role updated' });
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not update role', description: err.message });
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Team</h1>
          <p className="text-slate-500 text-sm mt-1">Everyone currently set up on StudioTime.</p>
        </div>
        {canManage && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Add team member</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editingId ? 'Edit team member' : 'Add team member'}</DialogTitle></DialogHeader>
              <form onSubmit={handleSave} className="space-y-4">
                {!editingId && (
                  <div className="space-y-2">
                    <Label>Account</Label>
                    <Select value={form.user_id} onValueChange={(v) => {
                      const u = platformUsers.find((p) => p.id === v);
                      setForm((f) => ({ ...f, user_id: v, name: u?.full_name || f.name }));
                    }} required>
                      <SelectTrigger><SelectValue placeholder="Select a registered user" /></SelectTrigger>
                      <SelectContent>
                        {usersWithoutTeamMember.map((u) => (
                          <SelectItem key={u.id} value={u.id}>{u.full_name} ({u.email})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Studio role</Label>
                    <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r] || r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="location">Location</Label>
                    <Input id="location" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cost_rate">Cost rate</Label>
                    <Input id="cost_rate" type="number" step="0.01" value={form.cost_rate} onChange={(e) => setForm((f) => ({ ...f, cost_rate: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="selling_rate">Selling rate</Label>
                    <Input id="selling_rate" type="number" step="0.01" value={form.selling_rate} onChange={(e) => setForm((f) => ({ ...f, selling_rate: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="currency">Currency</Label>
                    <Input id="currency" value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="mhd">Max h/day</Label>
                    <Input id="mhd" type="number" value={form.max_hours_day} onChange={(e) => setForm((f) => ({ ...f, max_hours_day: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mhw">Max h/week</Label>
                    <Input id="mhw" type="number" value={form.max_hours_week} onChange={(e) => setForm((f) => ({ ...f, max_hours_week: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mhm">Max h/month</Label>
                    <Input id="mhm" type="number" value={form.max_hours_month} onChange={(e) => setForm((f) => ({ ...f, max_hours_month: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mot">Max OT/week</Label>
                    <Input id="mot" type="number" value={form.max_overtime_hours_week} onChange={(e) => setForm((f) => ({ ...f, max_overtime_hours_week: e.target.value }))} />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    {editingId ? 'Save changes' : 'Add team member'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Roster</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Location</TableHead>
                  {roster.some((m) => 'email' in m) && <TableHead>Email</TableHead>}
                  {roster.some((m) => 'cost_rate' in m) && <TableHead>Cost / Selling</TableHead>}
                  {canManage && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell><Badge variant="secondary">{ROLE_LABELS[m.role] || m.role || '—'}</Badge></TableCell>
                    <TableCell>{m.location || '—'}</TableCell>
                    {roster.some((r) => 'email' in r) && <TableCell>{m.email || '—'}</TableCell>}
                    {roster.some((r) => 'cost_rate' in r) && (
                      <TableCell>{m.cost_rate ?? '—'} / {m.selling_rate ?? '—'} {m.currency || ''}</TableCell>
                    )}
                    {canManage && (
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(m)}><Pencil className="w-4 h-4" /></Button>
                        {admin && m.user_id !== user?.id && (
                          <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(m)}><Trash2 className="w-4 h-4" /></Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {roster.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-slate-400 py-8">No team members yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {admin && (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-base">Registered accounts</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Platform role</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {platformUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.full_name}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      {u.approved ? (
                        <Badge variant="secondary">Approved</Badge>
                      ) : (
                        <Badge variant="destructive">Pending</Badge>
                      )}
                      {u.account_status && u.account_status !== 'active' && (
                        <Badge variant="outline" className="ml-1 capitalize">{u.account_status}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select value={u.role} onValueChange={(v) => changePlatformRole(u, v)} disabled={u.id === user?.id}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      {!u.approved && (
                        <Button size="sm" variant="outline" onClick={() => approveUser(u)}>
                          <UserCheck className="w-4 h-4 mr-1" /> Approve
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes their team-member record (rates, role, limits). Their account and past timesheet history are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
