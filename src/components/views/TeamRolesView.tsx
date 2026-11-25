import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { TeamMember, Department } from '../../types';

export const TeamRolesView: React.FC = () => {
  const { teamMembers, setTeamMembers, addToast } = useApp();

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'Company Admin' | 'Company Staff'>('Company Staff');
  const [department, setDepartment] = useState<Department>('HR');

  const getStatusBadge = (status: TeamMember['status']) => {
    switch (status) {
      case 'Active · MFA on':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
            Active · MFA on
          </span>
        );
      case 'Active':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
            Active
          </span>
        );
      case 'Invited':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
            Invited
          </span>
        );
      case 'Deactivated':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            Deactivated
          </span>
        );
    }
  };

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email) return;

    const newMember: TeamMember = {
      id: String(Date.now()),
      name,
      email,
      role,
      department,
      status: 'Invited'
    };

    setTeamMembers(prev => [...prev, newMember]);
    setName('');
    setEmail('');
    setModalOpen(false);
    addToast('Invitation Sent', `Invitation sent to ${email}`, 'success');
  };

  const toggleDeactivate = (id: string) => {
    setTeamMembers(prev => prev.map(m => {
      if (m.id === id) {
        const nextStatus = m.status === 'Deactivated' ? 'Active' : 'Deactivated';
        return { ...m, status: nextStatus };
      }
      return m;
    }));
    addToast('Status Updated', 'User access modified.', 'info');
  };

  return (
    <div className="space-y-6">
      {/* Header bar matching pages 8 & 22 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Team & Roles
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Invite, deactivate and assign roles
          </p>
        </div>

        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle"
        >
          <UserPlus size={14} />
          <span>+ Invite user</span>
        </button>
      </div>

      {/* Team Table matching Screenshot */}
      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-400 text-[11px] font-medium bg-slate-50/60 dark:bg-slate-900/40">
                <th className="py-3 px-6 font-medium">Name</th>
                <th className="py-3 px-6 font-medium">Email</th>
                <th className="py-3 px-6 font-medium">Role</th>
                <th className="py-3 px-6 font-medium">Department</th>
                <th className="py-3 px-6 font-medium">Status</th>
                <th className="py-3 px-6 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-normal">
              {teamMembers.map(member => (
                <tr
                  key={member.id}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="py-3.5 px-6 font-medium text-slate-900 dark:text-white">
                    {member.name}
                  </td>
                  <td className="py-3.5 px-6 text-slate-500 dark:text-slate-400">
                    {member.email}
                  </td>
                  <td className="py-3.5 px-6 text-slate-700 dark:text-slate-300">
                    {member.role}
                  </td>
                  <td className="py-3.5 px-6 text-slate-600 dark:text-slate-300">
                    {member.department}
                  </td>
                  <td className="py-3.5 px-6">
                    {getStatusBadge(member.status)}
                  </td>
                  <td className="py-3.5 px-6 text-right">
                    <button
                      onClick={() => toggleDeactivate(member.id)}
                      className="text-xs font-medium text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                    >
                      {member.status === 'Deactivated' ? 'Activate' : 'Deactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 w-full max-w-md shadow-modal space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Invite Team Member
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleInviteSubmit} className="space-y-4 text-xs">
              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rajiv Menon"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none focus:border-brand-600"
                />
              </div>

              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Work Email
                </label>
                <input
                  type="email"
                  required
                  placeholder="rajiv@gsign.in"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none focus:border-brand-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Role
                  </label>
                  <select
                    value={role}
                    onChange={e => setRole(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none"
                  >
                    <option value="Company Staff">Company Staff</option>
                    <option value="Company Admin">Company Admin</option>
                  </select>
                </div>

                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Department
                  </label>
                  <select
                    value={department}
                    onChange={e => setDepartment(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none"
                  >
                    <option value="HR">HR</option>
                    <option value="Legal">Legal</option>
                    <option value="Ops">Ops</option>
                    <option value="Sales">Sales</option>
                    <option value="Executive">Executive</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-white bg-brand-600 hover:bg-brand-700 font-medium shadow-subtle"
                >
                  Send Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
