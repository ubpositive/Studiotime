import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Check, X } from 'lucide-react';

export default function Approvals() {
  const [data, setData] = useState({ roster: [], projects: [], timesheet_entries: [] });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const result = await base44.approvals.queue();
      setData(result);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not load approvals', description: err.message });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const memberByUserId = useMemo(() => {
    const map = {};
    for (const m of data.roster || []) map[m.user_id] = m;
    return map;
  }, [data.roster]);
  const projectById = useMemo(() => {
    const map = {};
    for (const p of data.projects || []) map[p.id] = p;
    return map;
  }, [data.projects]);

  const pending = (data.timesheet_entries || [])
    .filter((e) => e.status === 'submitted')
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const approve = async (entry) => {
    setBusyId(entry.id);
    try {
      await base44.approvals.approve(entry.id);
      toast({ title: 'Entry approved' });
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not approve', description: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const openReject = (entry) => { setRejectTarget(entry); setRejectReason(''); };
  const submitReject = async () => {
    if (!rejectReason.trim()) return;
    setBusyId(rejectTarget.id);
    try {
      await base44.approvals.reject(rejectTarget.id, rejectReason.trim());
      toast({ title: 'Entry rejected' });
      setRejectTarget(null);
      load();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not reject', description: err.message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Approvals</h1>
        <p className="text-slate-500 text-sm mt-1">Submitted time entries waiting on your review.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team member</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Stage / Task</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{memberByUserId[entry.user_id]?.name || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">{entry.date}</TableCell>
                    <TableCell>{projectById[entry.project_id]?.name || '—'}</TableCell>
                    <TableCell>{[entry.stage, entry.task].filter(Boolean).join(' / ') || '—'}</TableCell>
                    <TableCell>{entry.hours ?? '—'}</TableCell>
                    <TableCell className="max-w-xs truncate text-slate-500">{entry.notes || '—'}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" disabled={busyId === entry.id} onClick={() => approve(entry)}>
                        <Check className="w-4 h-4 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" disabled={busyId === entry.id} onClick={() => openReject(entry)}>
                        <X className="w-4 h-4 mr-1" /> Reject
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {pending.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-slate-400 py-8">Nothing waiting on you right now.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject entry</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-slate-500">
              {rejectTarget && `${memberByUserId[rejectTarget.user_id]?.name || 'This team member'} — ${rejectTarget.date}, ${rejectTarget.hours ?? '—'}h`}
            </p>
            <Textarea
              placeholder="Reason for rejection (required)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="destructive" disabled={!rejectReason.trim() || busyId === rejectTarget?.id} onClick={submitReject}>
              Reject entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
