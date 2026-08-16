import { supabase } from './supabase';
import type { Project, ProjectMember, ProjectStatus, Profile, TeamMember } from './types';
import { logActivity } from './activity-api';

// ── Project visibility ──────────────────────────────────────────────
// Source of truth for "which projects can this user see". Admins see
// everything; everyone else sees only projects they're an explicit
// member of. This is enforced here (server-side, via Postgres RPC)
// rather than by filtering an already-fetched full list client-side,
// so a non-admin can't see unauthorized projects by inspecting
// network responses either.
export async function fetchMyProjects(userId: string, isAdmin: boolean): Promise<Project[]> {
  if (isAdmin) {
    const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  const { data: ids, error: idsError } = await supabase.rpc('my_project_ids', { p_user_id: userId });
  if (idsError) throw idsError;
  const projectIds = (ids ?? []).map((r: { my_project_ids?: string } | string) =>
    typeof r === 'string' ? r : r.my_project_ids,
  ).filter(Boolean) as string[];

  if (!projectIds.length) return [];

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .in('id', projectIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// Confirms server-side that a user actually has access to a project —
// call this before showing project-scoped data (dashboard, timeline,
// issues, chat) for a project id that came from a route/URL, not just
// from a list you already fetched.
export async function verifyProjectAccess(userId: string, projectId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_project_member', {
    p_user_id: userId,
    p_project_id: projectId,
  });
  if (error) throw error;
  return !!data;
}

// ── Projects (admin CRUD, team-scoped) ──────────────────────────────
export interface CreateProjectInput {
  key: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  team_id: string;
  lead_id?: string | null;
  status?: ProjectStatus;
  start_date?: string | null;
  end_date?: string | null;
  memberIds: string[];
}

export async function createProjectWithMembers(input: CreateProjectInput): Promise<Project> {
  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      team_id: input.team_id,
      lead_id: input.lead_id ?? null,
      status: input.status ?? 'active',
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
    })
    .select()
    .single();
  if (error) throw error;

  const memberIds = Array.from(new Set([...input.memberIds, ...(input.lead_id ? [input.lead_id] : [])]));
  if (memberIds.length) {
    await addProjectMembers(
      project.id,
      memberIds,
      input.lead_id ?? undefined,
    );
  }

  return project;
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<Project> {
  const { data, error } = await supabase.from('projects').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

// ── Project members ──────────────────────────────────────────────────
export async function fetchProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const { data, error } = await supabase.from('project_members').select('*').eq('project_id', projectId);
  if (error) throw error;
  return data ?? [];
}

export async function fetchProjectMemberProfiles(projectId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('project_members')
    .select('user_id, users!inner(id,email,full_name,avatar_initials,role,team_id,created_at)')
    .eq('project_id', projectId);
  if (error) throw error;
  return (data ?? []).map((row: unknown) => (row as { users: Profile }).users);
}

export async function addProjectMembers(projectId: string, userIds: string[], leadId?: string): Promise<void> {
  const ids = Array.from(new Set(userIds));
  if (!ids.length) return;
  const rows = ids.map((user_id) => ({
    project_id: projectId,
    user_id,
    role: leadId && user_id === leadId ? 'lead' : 'member',
  }));
  const { error } = await supabase.from('project_members').upsert(rows, { onConflict: 'project_id,user_id' });
  if (error) throw error;

  await logActivity(projectId, {
    type: 'member_added',
    summary: ids.length === 1 ? 'A member was added to the project' : `${ids.length} members were added to the project`,
  }).catch(() => {});
}

export async function removeProjectMember(projectId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (error) throw error;

  await logActivity(projectId, {
    type: 'member_removed',
    summary: 'A member was removed from the project',
  }).catch(() => {});
}

export async function setProjectMemberRole(projectId: string, userId: string, role: 'lead' | 'member'): Promise<void> {
  const { error } = await supabase
    .from('project_members')
    .update({ role })
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (error) throw error;
}

// ── Team members ─────────────────────────────────────────────────────
export async function fetchTeamMembers(teamId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase.from('team_members').select('*').eq('team_id', teamId);
  if (error) throw error;
  return data ?? [];
}

export async function addTeamMember(teamId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('team_members').upsert({ team_id: teamId, user_id: userId });
  if (error) throw error;
  // Keep users.team_id ("home" team) pointed at the most recent team add,
  // consistent with the existing Admin → Users team dropdown.
  await supabase.from('users').update({ team_id: teamId }).eq('id', userId);
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('team_members').delete().eq('team_id', teamId).eq('user_id', userId);
  if (error) throw error;
}

