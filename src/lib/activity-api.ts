import { supabase } from './supabase';
import type { ActivityEntry, ActivityType } from './types';

export async function fetchProjectTimeline(projectId: string, limit = 100): Promise<ActivityEntry[]> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export interface LogActivityInput {
  type: ActivityType;
  summary: string;
  actor_id?: string | null;
  actor_name?: string | null;
  issue_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function logActivity(projectId: string, input: LogActivityInput): Promise<void> {
  const { error } = await supabase.from('activity_log').insert({
    project_id: projectId,
    type: input.type,
    summary: input.summary,
    actor_id: input.actor_id ?? null,
    actor_name: input.actor_name ?? null,
    issue_id: input.issue_id ?? null,
    metadata: input.metadata ?? null,
  });
  if (error) throw error;
}

export function subscribeToProjectTimeline(projectId: string, onInsert: (entry: ActivityEntry) => void) {
  const channel = supabase
    .channel(`activity-${projectId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'activity_log', filter: `project_id=eq.${projectId}` },
      (payload) => onInsert(payload.new as ActivityEntry),
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
