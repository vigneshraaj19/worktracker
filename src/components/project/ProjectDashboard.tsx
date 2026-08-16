import { useEffect, useState, useCallback, useMemo } from "react";
import { Box, Typography, Paper, Grid, CircularProgress } from "@mui/material";
import type { Project, Issue, ActivityEntry } from "@/lib/types";
import { AssigneeAvatar } from "@/components/ui/Badges";
import { fetchProjectMemberProfiles } from "@/lib/hierarchy-api";
import { fetchProjectTimeline, subscribeToProjectTimeline } from "@/lib/activity-api";
import { iconFor } from "@/lib/icons";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ProjectDashboard({ project, issues }: { project: Project; issues: Issue[] }) {
  const [members, setMembers] = useState<{ id: string; full_name: string | null; email: string; avatar_initials: string | null }[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, a] = await Promise.all([
        fetchProjectMemberProfiles(project.id),
        fetchProjectTimeline(project.id, 8),
      ]);
      setMembers(m);
      setActivity(a);
    } catch {
      // dashboard is best-effort supplementary info — leave stale data visible
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    load();
    const unsubscribe = subscribeToProjectTimeline(project.id, (entry) => {
      setActivity((prev) => [entry, ...prev].slice(0, 8));
    });
    return unsubscribe;
  }, [project.id, load]);

  const stats = useMemo(() => {
    const total = issues.length;
    const completed = issues.filter((i) => i.status === "done").length;
    const inProgress = issues.filter((i) => i.status === "in_progress" || i.status === "in_review").length;
    const pending = total - completed - inProgress;
    return { total, completed, inProgress, pending };
  }, [issues]);

  const ClockIcon = iconFor("Calendar");

  return (
    <Box sx={{ height: "100%", overflow: "auto", bgcolor: "#f8fafc", p: { xs: 2, md: 4 } }}>
      <Box sx={{ mb: 3 }}>
        <Typography sx={{ fontWeight: 800, fontSize: "1.3rem" }}>{project.name}</Typography>
        <Typography sx={{ fontSize: "0.8rem", color: "#94a3b8" }}>Project dashboard</Typography>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { label: "Total Issues", value: stats.total, color: "#1e293b" },
          { label: "Completed", value: stats.completed, color: "#16a34a" },
          { label: "In Progress", value: stats.inProgress, color: "#d97706" },
          { label: "Pending", value: stats.pending, color: "#64748b" },
        ].map((s) => (
          <Grid item xs={6} md={3} key={s.label}>
            <Paper elevation={0} sx={{ p: 2, borderRadius: 3, border: "1px solid #e2e8f0" }}>
              <Typography sx={{ fontSize: "1.7rem", fontWeight: 800, color: s.color }}>{s.value}</Typography>
              <Typography sx={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 500 }}>{s.label}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Paper elevation={0} sx={{ borderRadius: 3, border: "1px solid #e2e8f0", p: 2.5 }}>
            <Typography sx={{ fontWeight: 700, fontSize: "0.9rem", mb: 1.5 }}>Team Members</Typography>
            {loading ? (
              <CircularProgress size={18} sx={{ color: "#4f46e5" }} />
            ) : members.length === 0 ? (
              <Typography sx={{ fontSize: "0.8rem", color: "#94a3b8" }}>No members assigned yet.</Typography>
            ) : (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
                {members.map((m) => (
                  <Box key={m.id} sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5, width: 64 }}>
                    <AssigneeAvatar name={m.full_name ?? m.email} initials={m.avatar_initials} size={40} />
                    <Typography sx={{ fontSize: "0.68rem", textAlign: "center", color: "#334155", lineHeight: 1.2 }}>
                      {(m.full_name ?? m.email).split(" ")[0]}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={7}>
          <Paper elevation={0} sx={{ borderRadius: 3, border: "1px solid #e2e8f0", p: 2.5 }}>
            <Typography sx={{ fontWeight: 700, fontSize: "0.9rem", mb: 1.5 }}>Recent Activity</Typography>
            {loading ? (
              <CircularProgress size={18} sx={{ color: "#4f46e5" }} />
            ) : activity.length === 0 ? (
              <Typography sx={{ fontSize: "0.8rem", color: "#94a3b8" }}>No activity yet.</Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
                {activity.map((a) => (
                  <Box key={a.id} sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                    <ClockIcon size={13} color="#94a3b8" style={{ marginTop: 3, flexShrink: 0 }} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: "0.82rem", color: "#334155" }}>{a.summary}</Typography>
                      <Typography sx={{ fontSize: "0.7rem", color: "#94a3b8" }}>{timeAgo(a.created_at)}</Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
