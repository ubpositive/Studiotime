import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import {
  Clock, CheckSquare, Users, FolderKanban, CalendarRange, Settings, LogOut, Compass,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ROLE_LABELS, isAdmin, canSeeApprovals, canSeePlanning } from '@/lib/permissions';

export default function Layout() {
  const { user, teamMember, logout } = useAuth();
  const admin = isAdmin(user);

  const navItems = [
    { to: '/', label: 'Timesheets', icon: Clock, end: true },
  ];
  if (canSeeApprovals({ user, teamMember })) navItems.push({ to: '/approvals', label: 'Approvals', icon: CheckSquare });
  navItems.push({ to: '/team', label: 'Team', icon: Users });
  navItems.push({ to: '/projects', label: 'Projects', icon: FolderKanban });
  if (canSeePlanning({ user, teamMember })) navItems.push({ to: '/planning', label: 'Planning', icon: CalendarRange });
  if (admin) navItems.push({ to: '/admin', label: 'Admin', icon: Settings });

  return (
    <div className="flex h-screen bg-slate-50">
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0">
        <div className="px-6 py-6 flex items-center gap-3 border-b border-slate-800">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
            <Compass className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-white font-semibold text-sm leading-tight">StudioTime</h1>
            <p className="text-slate-500 text-xs">Timesheets &amp; Planning</p>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-slate-800">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-white text-sm font-semibold shrink-0">
              {(user?.full_name || user?.email || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{user?.full_name || user?.email || 'User'}</p>
              <span className="text-slate-400 text-xs">{ROLE_LABELS[teamMember?.role] || (admin ? 'Admin' : 'Team Member')}</span>
            </div>
          </div>
          <NavLink
            to="/change-password"
            className="flex items-center gap-3 mt-1 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800"
          >
            Change password
          </NavLink>
          <Button
            variant="ghost"
            onClick={() => logout()}
            className="w-full mt-1 text-slate-400 hover:text-white hover:bg-slate-800 justify-start"
          >
            <LogOut className="w-4 h-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
