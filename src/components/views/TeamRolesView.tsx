import React, { useEffect, useState } from 'react';
import { UserPlus, Edit3, Mail, Clock, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { TeamMember } from '../../types';

interface RoleOption {
  id: string;
  name: string;
  description?: string;
}

interface InvitationRow {
  id: string;
  email: string;
  role_name: string;
  department: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

const DEPARTMENTS = ['HR', 'Legal', 'Ops', 'Sales', 'Executive', 'Finance', 'General'];

export const TeamRolesView: React.FC = () => {
  const { teamMembers, setTeamMembers, addToast } = useApp();

  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // Invite modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [roleName, setRoleName] = useState('HR Manager');
  const [department, setDepartment] = useState('HR');
  const [inviting, setInviting] = useState(false);

  // Edit role modal state
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [editRoleName, setEditRoleName] = useState('');
  const [editDepartment, setEditDepartment] = useState('');
  const [savingRole, setSavingRole] = useState(false);

  // Deactivate confirmation modal state
  const [confirmToggleMember, setConfirmToggleMember] = useState<TeamMember | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const refreshTeamData = async () => {
    setLoadingData(true);
    try {
      const [liveUsers, liveRoles, liveInvites] = await Promise.all([
        api.getUsers().catch(() => []),
        api.getRoles().catch(() => []),
        api.getTeamInvitations().catch(() => []),
      ]);

      const assignableRoles = (Array.isArray(liveRoles) ? liveRoles : []).filter(
        (r: any) => r.name !== 'PLATFORM_OWNER' && r.name !== 'Super Admin',
      );
      setRoles(assignableRoles);
      if (assignableRoles.length > 0 && !assignableRoles.some((r: any) => r.name === roleName)) {
        setRoleName(assignableRoles[0].name);
      }

      if (Array.isArray(liveUsers)) {
        setTeamMembers(
          liveUsers.map((u: any) => ({
            id: u.id,
            name: u.full_name,
            email: u.email,
            role: (u.role_name || 'Member') as TeamMember['role'],
            department: u.department || 'General',
            status: u.membership_status === 'Active' && u.is_active ? 'Active' : 'Deactivated',
            joinedAt: u.joined_at ? new Date(u.joined_at).toLocaleDateString() : '—',
          })),
        );
      }

      setInvitations(Array.isArray(liveInvites) ? liveInvites : []);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    refreshTeamData();
  }, []);

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

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !roleName || inviting) return;
    setInviting(true);
    try {
      const res = await api.inviteTeamMember({
        email: email.trim().toLowerCase(),
        role_name: roleName,
        department,
      });
      setEmail('');
      setModalOpen(false);
      await refreshTeamData();
      if (res.email_delivery && !res.email_delivery.sent) {
        addToast(
          'Invitation Saved (Email Pending)',
          `Invitation created for ${email}, but email delivery failed: ${res.email_delivery.error || 'Provider error'}.`,
          'error',
        );
      } else {
        addToast('Invitation Sent', `Invitation email dispatched to ${email}.`, 'success');
      }
    } catch (err: any) {
      addToast('Invitation Failed', err.message || 'Could not invite employee.', 'error');
    } finally {
      setInviting(false);
    }
  };

  const handleOpenEditRole = (member: TeamMember) => {
    setEditingMember(member);
    setEditRoleName(member.role);
    setEditDepartment(member.department || 'General');
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember || !editRoleName || savingRole) return;
    setSavingRole(true);
    try {
      await api.updateUserRole(editingMember.id, {
        role_name: editRoleName,
        department: editDepartment,
      });
      setEditingMember(null);
      await refreshTeamData();
      addToast('Role Updated', `Updated role for ${editingMember.name} to ${editRoleName}.`, 'success');
    } catch (err: any) {
      addToast('Role Update Failed', err.message || 'Could not update member role.', 'error');
    } finally {
      setSavingRole(false);
    }
  };

  const handleConfirmToggleStatus = async () => {
    if (!confirmToggleMember) return;
    const target = confirmToggleMember;
    const nextStatus = target.status === 'Deactivated' ? 'Active' : 'Deactivated';
    setTogglingId(target.id);
    try {
      await api.updateUserStatus(target.id, nextStatus);
      setConfirmToggleMember(null);
      await refreshTeamData();
      addToast(
        nextStatus === 'Active' ? 'Member Reactivated' : 'Member Deactivated',
        nextStatus === 'Active'
          ? `${target.name} can now access the workspace.`
          : `${target.name} has been deactivated and active sessions revoked.`,
        nextStatus === 'Active' ? 'success' : 'info',
      );
    } catch (err: any) {
      addToast('Status Update Failed', err.message || 'Could not update member status.', 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const pendingInvites = invitations.filter((inv) => !inv.accepted_at);

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Team & Roles
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Invite employees, assign workspace roles, and manage active access
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshTeamData}
            disabled={loadingData}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <RefreshCw size={13} className={loadingData ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-subtle"
          >
            <UserPlus size={14} />
            <span>+ Invite user</span>
          </button>
        </div>
      </div>

      {/* Team Members Table */}
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
                <th className="py-3 px-6 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-normal">
              {teamMembers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 px-6 text-center text-slate-400">
                    {loadingData ? 'Loading team members...' : 'No workspace members found.'}
                  </td>
                </tr>
              ) : (
                teamMembers.map((member) => (
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
                    <td className="py-3.5 px-6 text-right space-x-3">
                      <button
                        type="button"
                        onClick={() => handleOpenEditRole(member)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                      >
                        <Edit3 size={12} />
                        <span>Edit role</span>
                      </button>
                      <button
                        type="button"
                        disabled={togglingId === member.id}
                        onClick={() => setConfirmToggleMember(member)}
                        className={`text-xs font-medium transition-colors disabled:opacity-50 ${
                          member.status === 'Deactivated'
                            ? 'text-emerald-600 hover:text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-500 hover:text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {member.status === 'Deactivated' ? 'Activate' : 'Deactivate'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending / Expired Invitations */}
      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-card overflow-hidden">
        <div className="px-6 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
            <Mail size={14} className="text-brand-600" />
            <span>Pending & Recent Invitations</span>
          </div>
          <span className="text-[11px] text-slate-400">
            {pendingInvites.length} pending
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 text-[11px] font-medium bg-slate-50/60 dark:bg-slate-900/40">
                <th className="py-2.5 px-6 font-medium">Email</th>
                <th className="py-2.5 px-6 font-medium">Role</th>
                <th className="py-2.5 px-6 font-medium">Department</th>
                <th className="py-2.5 px-6 font-medium">Status</th>
                <th className="py-2.5 px-6 font-medium">Expires</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {invitations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 px-6 text-center text-slate-400">
                    No invitations sent yet.
                  </td>
                </tr>
              ) : (
                invitations.map((inv) => {
                  const isAccepted = Boolean(inv.accepted_at);
                  const isExpired = !isAccepted && new Date(inv.expires_at) <= new Date();
                  return (
                    <tr key={inv.id}>
                      <td className="py-3 px-6 font-medium text-slate-800 dark:text-slate-200">
                        {inv.email}
                      </td>
                      <td className="py-3 px-6 text-slate-600 dark:text-slate-300">
                        {inv.role_name}
                      </td>
                      <td className="py-3 px-6 text-slate-600 dark:text-slate-300">
                        {inv.department}
                      </td>
                      <td className="py-3 px-6">
                        {isAccepted ? (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800/60">
                            Accepted
                          </span>
                        ) : isExpired ? (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700">
                            Expired
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60">
                            <Clock size={10} />
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-6 font-mono text-slate-400">
                        {new Date(inv.expires_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })
              )}
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
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleInviteSubmit} className="space-y-4 text-xs">
              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Work Email
                </label>
                <input
                  type="email"
                  required
                  placeholder="rajiv@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none focus:border-brand-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Role
                  </label>
                  <select
                    value={roleName}
                    onChange={(e) => setRoleName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none"
                  >
                    {roles.length === 0 ? (
                      <>
                        <option value="HR Manager">HR Manager</option>
                        <option value="Legal Reviewer">Legal Reviewer</option>
                        <option value="Sales Executive">Sales Executive</option>
                        <option value="Company Admin">Company Admin</option>
                      </>
                    ) : (
                      roles.map((r) => (
                        <option key={r.id} value={r.name}>
                          {r.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                    Department
                  </label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none"
                  >
                    {DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
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
                  disabled={inviting}
                  className="px-4 py-1.5 rounded-lg text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 font-medium shadow-subtle"
                >
                  {inviting ? 'Sending...' : 'Send Invitation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Role Modal */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 w-full max-w-md shadow-modal space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Edit Member Role — {editingMember.name}
              </h3>
              <button type="button" onClick={() => setEditingMember(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRole} className="space-y-4 text-xs">
              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Workspace Role
                </label>
                <select
                  value={editRoleName}
                  onChange={(e) => setEditRoleName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.name}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-medium text-slate-700 dark:text-slate-300 block mb-1">
                  Department
                </label>
                <select
                  value={editDepartment}
                  onChange={(e) => setEditDepartment(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 outline-none"
                >
                  {DEPARTMENTS.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingMember(null)}
                  className="px-3.5 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingRole}
                  className="px-4 py-1.5 rounded-lg text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 font-medium shadow-subtle"
                >
                  {savingRole ? 'Saving...' : 'Save Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deactivate / Activate Confirmation Modal */}
      {confirmToggleMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 w-full max-w-md shadow-modal space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                GSIGN — {confirmToggleMember.status === 'Deactivated' ? 'Reactivate' : 'Deactivate'} Member
              </h3>
              <button type="button" onClick={() => setConfirmToggleMember(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {confirmToggleMember.status === 'Deactivated'
                ? `Restore workspace access for "${confirmToggleMember.name}" (${confirmToggleMember.email})?`
                : `Deactivate "${confirmToggleMember.name}" (${confirmToggleMember.email})? Their active workspace sessions will be revoked immediately.`}
            </p>
            <div className="pt-2 flex justify-end gap-2.5 text-xs">
              <button
                type="button"
                onClick={() => setConfirmToggleMember(null)}
                className="px-3.5 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={togglingId === confirmToggleMember.id}
                onClick={handleConfirmToggleStatus}
                className={`px-4 py-1.5 rounded-lg text-white font-medium shadow-subtle disabled:opacity-50 ${
                  confirmToggleMember.status === 'Deactivated'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {togglingId === confirmToggleMember.id
                  ? 'Updating...'
                  : confirmToggleMember.status === 'Deactivated'
                    ? 'Reactivate Member'
                    : 'Deactivate Member'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
