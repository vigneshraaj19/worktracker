import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Typography, CircularProgress } from "@mui/material";
import type { Project, ActivityEntry, ActivityType } from "@/lib/types";
import { fetchProjectTimeline, subscribeToProjectTimeline } from "@/lib/activity-api";
import { iconFor } from "@/lib/icons";

const TYPE_ICON: Record<ActivityType, string> = {
  project_created: "Rocket",
  issue_created: "Plus",
  issue_status_changed: "ChevronRight",
  issue_assigned: "User",
  issue_completed: "CheckCheck",
  comment_added: "MessageCircle",
  member_added: "Users",
  member_removed: "Users",
  milestone: "Flag",
};

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function ProjectTimeline({ project }: { project: Project }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchProjectTimeline(project.id, 200);
      setEntries(data);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    load();
    const unsubscribe = subscribeToProjectTimeline(project.id, (entry) => {
      setEntries((prev) => [entry, ...prev]);
    });
    return unsubscribe;
  }, [project.id, load]);

  const groupedByDay = useMemo(() => {
    const groups = new Map<string, ActivityEntry[]>();
    entries.forEach((e) => {
      const key = dayLabel(e.created_at);
      const list = groups.get(key) ?? [];
      list.push(e);
      groups.set(key, list);
    });
    return [...groups.entries()];
  }, [entries]);

  return (
    <Box sx={{ height: "100%", overflow: "auto", bgcolor: "#f8fafc", p: { xs: 2, md: 4 } }}>
      <Box sx={{ mb: 3 }}>
        <Typography sx={{ fontWeight: 800, fontSize: "1.3rem" }}>{project.name}</Typography>
        <Typography sx={{ fontSize: "0.8rem", color: "#94a3b8" }}>Project timeline</Typography>
      </Box>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress size={22} sx={{ color: "#4f46e5" }} />
        </Box>
      ) : entries.length === 0 ? (
        <Typography sx={{ fontSize: "0.85rem", color: "#94a3b8", textAlign: "center", py: 6 }}>
          No activity yet for this project.
        </Typography>
      ) : (
        <Box sx={{ maxWidth: 640 }}>
          {groupedByDay.map(([day, items]) => (
            <Box key={day} sx={{ mb: 3 }}>
              <Typography sx={{ fontWeight: 700, fontSize: "0.8rem", color: "#475569", mb: 1.5 }}>{day}</Typography>
              <Box sx={{ borderLeft: "2px solid #e2e8f0", pl: 2.5, ml: 0.5, display: "flex", flexDirection: "column", gap: 2 }}>
                {items.map((entry) => {
                  const Icon = iconFor(TYPE_ICON[entry.type]);
                  return (
                    <Box key={entry.id} sx={{ position: "relative" }}>
                      <Box
                        sx={{
                          position: "absolute",
                          left: -30,
                          top: 2,
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          bgcolor: "#eef2ff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon size={11} color="#4f46e5" />
                      </Box>
                      <Typography sx={{ fontSize: "0.7rem", color: "#94a3b8", fontWeight: 600 }}>
                        {timeLabel(entry.created_at)}
                      </Typography>
                      <Typography sx={{ fontSize: "0.85rem", color: "#1e293b" }}>{entry.summary}</Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
