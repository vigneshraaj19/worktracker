-- ══════════════════════════════════════════════════════════════════
-- Team → Project hierarchy, membership, timeline, richer notifications
-- Run after 001, 002, 003, 004, 005_chat.
--
-- Adds:
--   • projects.team_id        — a project belongs to exactly one team
--   • team_members            — explicit team roster (separate from
--                                users.team_id, which stays as each
--                                user's "home" team for back-compat)
--   • project_members         — explicit project roster; this is the
--                                source of truth for project visibility
--   • activity_log            — project timeline entries
--   • message_mentions        — structured @mention records keyed by
--                                user_id (not by matched text), so a
--                                mention notification always resolves
--                                to exactly one intended recipient
--   • notifications.type      — widened to also allow chat_message,
--                                project_update, task_assigned,
--                                task_status_changed
--   • notifications.project_id / team_id / conversation_id / message_id
--                              — richer targets for notification nav
--
-- Same trade-off as 004/005: this app authenticates against a plain
-- `users` table with no Supabase Auth session, so RLS can't key off
-- auth.uid(). Policies stay open (to public) like the rest of the
-- schema. Real per-request backend authorization for a plain local-
-- users model needs either (a) moving auth to Supabase Auth so
-- auth.uid() is populated, or (b) a real API server that checks
-- project_members before every query. This migration adds the
-- SECURITY DEFINER helper functions below so the frontend always
-- asks Postgres "am I actually a member of this project?" instead of
-- trusting a client-supplied id, which is the most meaningful
-- enforcement available without one of those two bigger changes.
-- ══════════════════════════════════════════════════════════════════

-- ── Projects belong to one team ────────────────────────────────────
alter table projects add column if not exists team_id uuid references teams(id) on delete set null;
alter table projects add column if not exists status text not null default 'active' check (status in ('active','on_hold','completed','archived'));
alter table projects add column if not exists start_date date;
alter table projects add column if not exists end_date date;
alter table projects add column if not exists lead_id uuid references users(id) on delete set null;

create index if not exists idx_projects_team_id on projects(team_id);

-- ── Team members (explicit roster) ─────────────────────────────────
create table if not exists team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- Backfill from users.team_id so existing assignments aren't lost
insert into team_members (team_id, user_id)
select team_id, id from users where team_id is not null
on conflict do nothing;

-- ── Project members (source of truth for visibility) ───────────────
create table if not exists project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member' check (role in ('lead','member')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists idx_project_members_user_id on project_members(user_id);

-- ── Timeline / activity log ─────────────────────────────────────────
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  actor_name text,
  type text not null check (type in (
    'project_created','issue_created','issue_status_changed','issue_assigned',
    'issue_completed','comment_added','member_added','member_removed','milestone'
  )),
  summary text not null,
  issue_id uuid references issues(id) on delete set null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_log_project_id on activity_log(project_id, created_at desc);

-- ── Structured @mentions (user_id, not matched text) ────────────────
create table if not exists message_mentions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  mentioned_user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_message_mentions_user on message_mentions(mentioned_user_id);

-- ── Widen notifications ─────────────────────────────────────────────
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('mention','assignment','comment','chat_message','project_update','task_assigned','task_status_changed'));

alter table notifications add column if not exists project_id uuid references projects(id) on delete cascade;
alter table notifications add column if not exists team_id uuid references teams(id) on delete cascade;
alter table notifications add column if not exists conversation_id uuid references channels(id) on delete cascade;
alter table notifications add column if not exists message_id uuid references messages(id) on delete cascade;
alter table notifications add column if not exists sender_id uuid references users(id) on delete set null;

-- ── RLS (kept open, matching the rest of the app — see note above) ──
alter table team_members enable row level security;
alter table project_members enable row level security;
alter table activity_log enable row level security;
alter table message_mentions enable row level security;

drop policy if exists "open access" on team_members;
create policy "open access" on team_members for all to public using (true) with check (true);

drop policy if exists "open access" on project_members;
create policy "open access" on project_members for all to public using (true) with check (true);

drop policy if exists "open access" on activity_log;
create policy "open access" on activity_log for all to public using (true) with check (true);

drop policy if exists "open access" on message_mentions;
create policy "open access" on message_mentions for all to public using (true) with check (true);

-- ── Helper functions ─────────────────────────────────────────────────
-- Real membership checks the frontend calls instead of trusting a
-- client-supplied project_id / team_id directly.
create or replace function public.is_project_member(p_user_id uuid, p_project_id uuid)
returns boolean as $$
  select exists (
    select 1 from project_members
    where user_id = p_user_id and project_id = p_project_id
  ) or exists (
    select 1 from users where id = p_user_id and role = 'admin'
  );
$$ language sql stable security definer;

create or replace function public.my_project_ids(p_user_id uuid)
returns setof uuid as $$
  select id from projects where
    exists (select 1 from users where id = p_user_id and role = 'admin')
  union
  select project_id from project_members where user_id = p_user_id;
$$ language sql stable security definer;

-- Keep a project's chat channel roster in sync with project_members
create or replace function public.sync_project_channel_members()
returns trigger as $$
declare
  v_channel_id uuid;
begin
  select id into v_channel_id from channels where project_id = coalesce(new.project_id, old.project_id) and type = 'project' limit 1;
  if v_channel_id is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    insert into channel_members (channel_id, user_id)
    values (v_channel_id, new.user_id)
    on conflict do nothing;
  elsif tg_op = 'DELETE' then
    delete from channel_members where channel_id = v_channel_id and user_id = old.user_id;
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

drop trigger if exists on_project_member_change_sync_channel on project_members;
create trigger on_project_member_change_sync_channel
  after insert or delete on project_members
  for each row execute procedure public.sync_project_channel_members();

-- Log a timeline entry whenever a project is created
create or replace function public.handle_project_activity()
returns trigger as $$
begin
  insert into activity_log (project_id, type, summary)
  values (new.id, 'project_created', new.name || ' was created');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_project_created_log_activity on projects;
create trigger on_project_created_log_activity
  after insert on projects
  for each row execute procedure public.handle_project_activity();

do $$
begin
  execute 'alter publication supabase_realtime add table activity_log';
exception when duplicate_object then null;
end $$;

-- ══════════════════════════════════════════════════════════════════
-- Notes:
-- 1. Existing projects created before this migration have team_id =
--    null and no project_members rows. Assign them a team and add
--    members from Admin → Projects, or manually:
--    update projects set team_id = '<team-id>' where id = '<project-id>';
--    insert into project_members (project_id, user_id) values (...);
-- 2. Until a project has at least one project_members row, only
--    admins will see it (my_project_ids only returns projects with an
--    explicit membership row, or all projects for admins).
-- ══════════════════════════════════════════════════════════════════
