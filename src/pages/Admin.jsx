import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogAction, AlertDialogCancel, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Loader2, Trash2, Plus, ShieldAlert } from 'lucide-react';

const PERMISSION_SHAPE = {
  projects: ['view_all', 'add', 'edit', 'delete'],
  project_members: ['add', 'edit', 'delete'],
  timesheets: ['approve', 'edit_approved'],
  resource_planning: ['view_team', 'view_all'],
  team: ['view', 'add', 'edit', 'delete'],
  budget: ['view', 'edit'],
  cost_rates: ['view', 'edit'],
  actual_cost: ['view', 'edit'],
  billed: ['view', 'edit'],
  cost_settings: ['view', 'edit'],
  setup_hours: ['edit'],
};
const AREA_LABELS = {
  projects: 'Projects', project_members: 'Project members', timesheets: 'Timesheets',
  resource_planning: 'Resource planning', team: 'Team', budget: 'Budget', cost_rates: 'Cost rates',
  actual_cost: 'Actual cost', billed: 'Billed', cost_settings: 'Cost settings', setup_hours: 'Setup hours',
};

const LIST_TYPES = [
  { value: 'stages', label: 'Stages' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'break_types', label: 'Break / leave types' },
  { value: 'team_roles', label: 'Team roles' },
  { value: 'hourly_rates', label: 'Hourly rates' },
];

function PermissionsPanel() {
  const { user } = useAuth();
  const [authority, setAuthority] = useState(null);
  const [delegation, setDelegation] = useState({ view_permissions: false, edit_permissions: false, reset_passwords: false });
  const [users, setUsers] = useState([]);
  const [targetId, setTargetId] = useState('');
  const [targetPerm, setTargetPerm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disableReason, setDisableReason] = useState('');
  const [reenableReason, setReenableReason] = useState('');
  const [tempPassword, setTempPassword] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [auth, userList] = await Promise.all([
        base44.permissions.authority(),
        base44.teamMembers.users(),
      ]);
      setAuthority(auth);
      setUsers(userList || []);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not load permissions', description: err.message });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const loadTarget = async (id) => {
    setTargetId(id);
    setTempPassword(null);
    if (!id) { setTargetPerm(null); return; }
    try {
      const perm = await base44.permissions.getUserPermission(id);
      setTargetPerm(perm);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not load permissions for user', description: err.message });
    }
  };

  const toggleArea = (area, action, value) => {
    setTargetPerm((p) => ({
      ...p,
      permissions: {
        ...p.permissions,
        [area]: { ...(p.permissions?.[area] || {}), [action]: value },
      },
    }));
  };

  const savePermissions = async () => {
    setSaving(true);
    try {
      await base44.permissions.saveUserPermission(targetId, targetPerm.permissions || {});
      toast({ title: 'Permissions saved' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not save', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const selfAppoint = async () => {
    try {
      const result = await base44.permissions.selfAppointDomainAdmin();
      setAuthority(result);
      toast({ title: 'You are now the Domain Admin' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not self-appoint', description: err.message });
    }
  };

  const saveDelegation = async () => {
    try {
      const result = await base44.permissions.setDelegation(delegation);
      setDelegation(result);
      toast({ title: 'Delegation updated' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not update delegation', description: err.message });
    }
  };

  const setDomainAdmin = async (isDomainAdmin) => {
    try {
      await base44.permissions.setDomainAdmin(targetId, isDomainAdmin);
      toast({ title: isDomainAdmin ? 'Domain Admin transferred' : 'Domain Admin revoked' });
      loadTarget(targetId);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not change Domain Admin', description: err.message });
    }
  };

  const resetOverrides = async () => {
    try {
      await base44.permissions.resetOverrides(targetId);
      toast({ title: 'Overrides reset to role defaults' });
      loadTarget(targetId);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not reset', description: err.message });
    }
  };

  const resetPassword = async () => {
    try {
      const result = await base44.permissions.resetPassword(targetId);
      setTempPassword(result.tempPassword);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not reset password', description: err.message });
    }
  };

  const disableAccount = async () => {
    try {
      await base44.permissions.disableAccount(targetId, disableReason);
      toast({ title: 'Account disabled' });
      setDisableReason('');
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not disable account', description: err.message });
    }
  };
  const reenableAccount = async () => {
    try {
      await base44.permissions.reenableAccount(targetId, reenableReason, 2);
      toast({ title: 'Account re-enabled' });
      setReenableReason('');
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not re-enable account', description: err.message });
    }
  };

  const targetUser = users.find((u) => u.id === targetId);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your authority</CardTitle>
          <CardDescription>
            {authority?.is_domain_admin ? 'You are the Domain Admin.' : 'You are a regular admin.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!authority?.is_domain_admin && (
            <Button variant="outline" onClick={selfAppoint}>
              <ShieldAlert className="w-4 h-4 mr-2" /> Become Domain Admin (only works if none exists yet)
            </Button>
          )}
          {authority?.is_domain_admin && (
            <div className="space-y-3 max-w-sm">
              <p className="text-sm text-slate-500">What regular admins can do without being Domain Admin:</p>
              {['view_permissions', 'edit_permissions', 'reset_passwords'].map((k) => (
                <div key={k} className="flex items-center justify-between">
                  <Label className="capitalize">{k.replace('_', ' ')}</Label>
                  <Switch checked={!!delegation[k]} onCheckedChange={(v) => setDelegation((d) => ({ ...d, [k]: v }))} />
                </div>
              ))}
              <Button size="sm" onClick={saveDelegation}>Save delegation</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Manage a user's permissions</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Select value={targetId} onValueChange={loadTarget}>
            <SelectTrigger className="max-w-sm"><SelectValue placeholder="Select a user" /></SelectTrigger>
            <SelectContent>
              {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name} ({u.email})</SelectItem>)}
            </SelectContent>
          </Select>

          {targetPerm && (
            <>
              <div className="flex items-center justify-between max-w-sm">
                <Label>Domain Admin</Label>
                <Switch checked={!!targetPerm.is_domain_admin} onCheckedChange={setDomainAdmin} />
              </div>

              <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                {Object.entries(PERMISSION_SHAPE).map(([area, actions]) => (
                  <div key={area} className="space-y-1">
                    <p className="text-sm font-medium text-slate-700">{AREA_LABELS[area]}</p>
                    {actions.map((action) => (
                      <div key={action} className="flex items-center justify-between text-sm">
                        <span className="text-slate-500 capitalize">{action.replace('_', ' ')}</span>
                        <Switch
                          checked={!!targetPerm.permissions?.[area]?.[action]}
                          onCheckedChange={(v) => toggleArea(area, action, v)}
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                <Button size="sm" disabled={saving} onClick={savePermissions}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Save permissions
                </Button>
                <Button size="sm" variant="outline" onClick={resetOverrides}>Reset to role defaults</Button>
                <Button size="sm" variant="outline" onClick={resetPassword}>Issue temporary password</Button>
              </div>
              {tempPassword && (
                <p className="text-sm bg-amber-50 border border-amber-200 rounded-md p-3">
                  Temporary password for {targetUser?.full_name}: <span className="font-mono font-semibold">{tempPassword}</span>
                  <br />Share this with them directly — it will not be shown again.
                </p>
              )}

              <div className="pt-4 border-t space-y-3 max-w-md">
                <p className="text-sm font-medium text-slate-700">Account status</p>
                {targetUser?.account_status === 'disabled' ? (
                  <div className="space-y-2">
                    <Textarea placeholder="Reason for re-enabling (min 5 chars)" value={reenableReason} onChange={(e) => setReenableReason(e.target.value)} />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="outline" disabled={reenableReason.trim().length < 5}>Re-enable account</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Re-enable {targetUser?.full_name}'s account?</AlertDialogTitle>
                          <AlertDialogDescription>Please confirm again — re-enabling requires double confirmation.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={reenableAccount}>Confirm re-enable</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Textarea placeholder="Reason for disabling (min 5 chars)" value={disableReason} onChange={(e) => setDisableReason(e.target.value)} />
                    <Button size="sm" variant="destructive" disabled={disableReason.trim().length < 5} onClick={disableAccount}>
                      Disable account
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OptionListsPanel() {
  const [listType, setListType] = useState('stages');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async (lt) => {
    setLoading(true);
    try {
      const result = await base44.entities.CustomOption.filter({ list_type: lt }, 'sort_order');
      setRows((result || []).map((r) => ({ ...r })));
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not load options', description: err.message });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(listType); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [listType]);

  const updateRow = (idx, field, value) => {
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  };
  const addRow = () => setRows((r) => [...r, { value: '', label: '', numeric_value: 0, sort_order: r.length }]);
  const removeRow = (idx) => setRows((r) => r.filter((_, i) => i !== idx));

  const save = async () => {
    setSaving(true);
    try {
      await base44.options.bulkUpdate(listType, rows.map((r) => ({
        value: r.value, label: r.label, numeric_value: Number(r.numeric_value) || 0, sort_order: Number(r.sort_order) || 0,
      })));
      toast({ title: 'List saved' });
      load(listType);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not save list', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Option lists</CardTitle>
        <CardDescription>These drive the dropdowns used across timesheets, projects and planning.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select value={listType} onValueChange={setListType}>
          <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LIST_TYPES.map((lt) => <SelectItem key={lt.value} value={lt.value}>{lt.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Value</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Numeric value</TableHead>
                <TableHead>Sort order</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, idx) => (
                <TableRow key={idx}>
                  <TableCell><Input value={r.value} onChange={(e) => updateRow(idx, 'value', e.target.value)} /></TableCell>
                  <TableCell><Input value={r.label} onChange={(e) => updateRow(idx, 'label', e.target.value)} /></TableCell>
                  <TableCell><Input type="number" value={r.numeric_value} onChange={(e) => updateRow(idx, 'numeric_value', e.target.value)} /></TableCell>
                  <TableCell><Input type="number" value={r.sort_order} onChange={(e) => updateRow(idx, 'sort_order', e.target.value)} /></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => removeRow(idx)}><Trash2 className="w-4 h-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={addRow}><Plus className="w-4 h-4 mr-1" /> Add row</Button>
          <Button size="sm" disabled={saving} onClick={save}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Save list
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Admin() {
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Admin</h1>
        <p className="text-slate-500 text-sm mt-1">Permissions, delegation, accounts and option lists.</p>
      </div>
      <Tabs defaultValue="permissions">
        <TabsList>
          <TabsTrigger value="permissions">Permissions &amp; access</TabsTrigger>
          <TabsTrigger value="options">Option lists</TabsTrigger>
        </TabsList>
        <TabsContent value="permissions" className="mt-4">
          <PermissionsPanel />
        </TabsContent>
        <TabsContent value="options" className="mt-4">
          <OptionListsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
