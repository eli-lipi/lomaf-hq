'use client';

import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { TEAMS } from '@/lib/constants';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'coach';
  team_id: number | null;
  team_name: string | null;
  avatar_url: string | null;
  created_at: string;
  last_login: string | null;
}

type FormState = {
  email: string;
  display_name: string;
  role: 'admin' | 'coach';
  team_id: number | null;
};

const EMPTY_FORM: FormState = {
  email: '',
  display_name: '',
  role: 'coach',
  team_id: null,
};

export default function UsersTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/users');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setUsers(json.users ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(u: UserRow) {
    setEditingId(u.id);
    setForm({
      email: u.email,
      display_name: u.display_name,
      role: u.role,
      team_id: u.team_id,
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.email || !form.display_name) {
      setError('Email and display name are required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const team = TEAMS.find((t) => t.team_id === form.team_id);
      const payload = {
        ...form,
        team_name: team?.team_name ?? null,
        ...(editingId ? { id: editingId } : {}),
      };
      const res = await fetch('/api/users', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to save');
      setModalOpen(false);
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save user');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(u: UserRow) {
    if (!confirm(`Remove ${u.display_name} (${u.email})?`)) return;
    try {
      const res = await fetch(`/api/users?id=${u.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to delete');
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete user');
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold">Users</h2>
          <p className="text-sm text-muted-foreground">Manage who can sign in. Only emails listed here can access LOMAF HQ.</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90"
        >
          <Plus size={16} />
          Add user
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{error}</div>
      )}

      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">No users yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">Name</th>
                <th className="text-left font-medium px-4 py-2.5">Email</th>
                <th className="text-left font-medium px-4 py-2.5">Role</th>
                <th className="text-left font-medium px-4 py-2.5">Team</th>
                <th className="text-left font-medium px-4 py-2.5">Last login</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium">{u.display_name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        u.role === 'admin'
                          ? 'inline-block px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary'
                          : 'inline-block px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground'
                      }
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{u.team_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => openEdit(u)}
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        className="p-1.5 text-red-500 hover:text-red-700 rounded"
                        title="Remove"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="bg-card border border-border rounded-lg shadow-lg w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{editingId ? 'Edit user' : 'Add user'}</h3>
              <button onClick={() => setModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Email (Gmail)</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background"
                  placeholder="name@gmail.com"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Display name</label>
                <input
                  type="text"
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'coach' })}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background"
                >
                  <option value="coach">Coach</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Team</label>
                <select
                  value={form.team_id ?? ''}
                  onChange={(e) =>
                    setForm({ ...form, team_id: e.target.value ? Number(e.target.value) : null })
                  }
                  className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background"
                >
                  <option value="">— None —</option>
                  {TEAMS.map((t) => (
                    <option key={t.team_id} value={t.team_id}>
                      {t.team_name} ({t.coach})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setModalOpen(false)}
                className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={submitting}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
