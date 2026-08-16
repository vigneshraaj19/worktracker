import { supabase } from "./supabase";
import type {
  Project,
  Issue,
  Comment,
  IssueStatus,
  IssueType,
  IssuePriority,
} from "./types";
import { notifyUserByName, notifyUsers } from "./notifications-api";
import { logActivity } from "./activity-api";

// ── Projects ──────────────────────────────────────────────
export async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createProject(input: {
  key: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
}): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}

// ── Issues ────────────────────────────────────────────────
export async function fetchIssues(projectId: string): Promise<Issue[]> {
  const { data, error } = await supabase
    .from("issues")
    .select("*")
    .eq("project_id", projectId)
    .order("rank", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createIssue(input: {
  project_id: string;
  key: string;
  summary: string;
  description?: string | null;
  status?: IssueStatus;
  type?: IssueType;
  priority?: IssuePriority;
  assignee_name?: string | null;
  assignee_avatar?: string | null;
  reporter_name?: string | null;
  labels?: string[] | null;
  story_points?: number | null;
  due_date?: string | null;
  rank?: number;
}): Promise<Issue> {
  const { data, error } = await supabase
    .from("issues")
    .insert(input)
    .select()
    .single();
  if (error) throw error;

  if (data.assignee_name) {
    notifyUserByName(data.assignee_name, {
      type: "task_assigned",
      title: `You were assigned ${data.key}`,
      body: data.summary,
      issue_id: data.id,
      project_id: data.project_id,
    }).catch(() => {
      // best-effort — a missed notification shouldn't block issue creation
    });
  }

  logActivity(data.project_id, {
    type: "issue_created",
    actor_name: data.reporter_name ?? null,
    summary: `${data.reporter_name ?? "Someone"} created issue ${data.key}`,
    issue_id: data.id,
  }).catch(() => {
    // timeline logging is best-effort — never block issue creation
  });

  return data;
}

export async function updateIssue(
  id: string,
  patch: Partial<Issue>,
): Promise<Issue> {
  const { data, error } = await supabase
    .from("issues")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  if (patch.assignee_name) {
    notifyUserByName(data.assignee_name, {
      type: "task_assigned",
      title: `You were assigned ${data.key}`,
      body: data.summary,
      issue_id: data.id,
      project_id: data.project_id,
    }).catch(() => {
      // best-effort — a missed notification shouldn't block the update
    });

    logActivity(data.project_id, {
      type: "issue_assigned",
      summary: `${data.key} was assigned to ${patch.assignee_name}`,
      issue_id: data.id,
    }).catch(() => {});
  }

  if (patch.status) {
    logActivity(data.project_id, {
      type: patch.status === "done" ? "issue_completed" : "issue_status_changed",
      summary:
        patch.status === "done"
          ? `${data.key} was completed`
          : `${data.key} moved to ${patch.status.replace("_", " ")}`,
      issue_id: data.id,
    }).catch(() => {});

    if (data.assignee_name) {
      notifyUserByName(data.assignee_name, {
        type: "task_status_changed",
        title: `${data.key} moved to ${patch.status.replace("_", " ")}`,
        body: data.summary,
        issue_id: data.id,
        project_id: data.project_id,
      }).catch(() => {});
    }
  }

  return data;
}

export async function deleteIssue(id: string): Promise<void> {
  const { error } = await supabase.from("issues").delete().eq("id", id);
  if (error) throw error;
}

export async function getNextIssueNumber(projectKey: string): Promise<number> {
  const { data, error } = await supabase
    .from("issues")
    .select("key")
    .like("key", `${projectKey}-%`);
  if (error) throw error;
  const max = (data ?? []).reduce((acc, row) => {
    const num = parseInt(row.key.split("-")[1] ?? "0", 10);
    return isNaN(num) ? acc : Math.max(acc, num);
  }, 0);
  return max + 1;
}

// ── Comments ──────────────────────────────────────────────
export async function fetchComments(issueId: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("issue_id", issueId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addComment(input: {
  issue_id: string;
  author_name: string;
  author_avatar?: string | null;
  body: string;
  /** Explicit user ids to notify — from the "Notify" picker in the comment box. Preferred over name-matching. */
  notifyUserIds?: string[];
}): Promise<Comment> {
  const { data, error } = await supabase
    .from("comments")
    .insert({
      issue_id: input.issue_id,
      author_name: input.author_name,
      author_avatar: input.author_avatar,
      body: input.body,
    })
    .select()
    .single();
  if (error) throw error;

  notifyCommentRecipients(input).catch(() => {
    // best-effort — a missed notification shouldn't block the comment
  });

  supabase
    .from("issues")
    .select("project_id,key")
    .eq("id", input.issue_id)
    .single()
    .then(({ data: issue }) => {
      if (issue) {
        logActivity(issue.project_id, {
          type: "comment_added",
          actor_name: input.author_name,
          summary: `${input.author_name} commented on ${issue.key}`,
          issue_id: input.issue_id,
        }).catch(() => {});
      }
    });

  return data;
}

async function notifyCommentRecipients(input: {
  issue_id: string;
  author_name: string;
  body: string;
  notifyUserIds?: string[];
}): Promise<void> {
  const { data: issue } = await supabase
    .from("issues")
    .select("key,assignee_name,reporter_name")
    .eq("id", input.issue_id)
    .single();

  const title = `${input.author_name} commented on ${issue?.key ?? "an issue"}`;
  const body = input.body.slice(0, 140);
  const explicitIds = new Set(input.notifyUserIds ?? []);

  if (explicitIds.size) {
    await notifyUsers([...explicitIds], { type: "comment", title, body, issue_id: input.issue_id });
  }

  // Fallback: best-effort match of the issue's assignee/reporter free-text
  // names to real accounts, for anyone not explicitly picked above.
  if (issue) {
    const fallbackNames = [issue.assignee_name, issue.reporter_name].filter(
      (name): name is string => !!name && name !== input.author_name,
    );
    for (const name of fallbackNames) {
      await notifyUserByName(name, { type: "comment", title, body, issue_id: input.issue_id });
    }
  }
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.from("comments").delete().eq("id", id);
  if (error) throw error;
}
