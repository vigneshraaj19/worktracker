import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  IconButton,
  Tabs,
  Tab,
  Switch,
  Button,
  Paper,
  CircularProgress,
} from "@mui/material";
import { iconFor } from "@/lib/icons";
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeToNotifications,
} from "@/lib/notifications-api";
import { getNotificationPrefs, setNotificationPrefs, playChatSound, playMentionSound } from "@/lib/sound";
import type { AppNotification, NotificationType } from "@/lib/types";

type FilterTab = "all" | "mentions" | "chat" | "projects" | "tasks";

const FILTER_TYPES: Record<FilterTab, NotificationType[] | null> = {
  all: null,
  mentions: ["mention"],
  chat: ["chat_message"],
  projects: ["project_update"],
  tasks: ["assignment", "task_assigned", "task_status_changed", "comment"],
};

const TYPE_LABEL: Record<NotificationType, string> = {
  mention: "Mention",
  assignment: "Assignment",
  comment: "Comment",
  chat_message: "Chat",
  project_update: "Project",
  task_assigned: "Assignment",
  task_status_changed: "Task",
};

const TYPE_COLOR: Record<NotificationType, string> = {
  mention: "#4f46e5",
  assignment: "#0891b2",
  comment: "#d97706",
  chat_message: "#6366f1",
  project_update: "#0d9488",
  task_assigned: "#0891b2",
  task_status_changed: "#7c3aed",
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationsView({
  userId,
  onBack,
  onNavigate,
}: {
  userId: string;
  onBack: () => void;
  onNavigate?: (n: AppNotification) => void;
}) {
  const BackIcon = iconFor("ChevronRight");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FilterTab>("all");
  const [prefs, setPrefs] = useState(getNotificationPrefs());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchNotifications(userId);
      setNotifications(list);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
    const unsubscribe = subscribeToNotifications(userId, (n) => {
      setNotifications((prev) => [n, ...prev]);
      if (n.type === "chat_message") playChatSound();
      if (n.type === "mention") playMentionSound();
    });
    return unsubscribe;
  }, [userId, load]);

  const filtered = useMemo(() => {
    const types = FILTER_TYPES[tab];
    if (!types) return notifications;
    return notifications.filter((n) => types.includes(n.type));
  }, [notifications, tab]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function handleClick(n: AppNotification) {
    if (!n.read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      markNotificationRead(n.id).catch(load);
    }
    onNavigate?.(n);
  }

  async function handleMarkAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    markAllNotificationsRead(userId).catch(load);
  }

  function togglePref(key: "chatSoundEnabled" | "mentionSoundEnabled" | "projectNotificationsEnabled") {
    setPrefs((prev) => setNotificationPrefs({ [key]: !prev[key] }));
  }

  return (
    <Box sx={{ height: "100%", overflow: "auto", bgcolor: "#f8fafc", p: { xs: 2, md: 4 } }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
        <IconButton onClick={onBack} sx={{ transform: "rotate(180deg)", color: "#64748b" }}>
          <BackIcon size={18} />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontWeight: 800, fontSize: "1.3rem" }}>Notifications</Typography>
          <Typography sx={{ fontSize: "0.8rem", color: "#94a3b8" }}>
            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
          </Typography>
        </Box>
        {unreadCount > 0 && (
          <Button size="small" onClick={handleMarkAllRead} sx={{ textTransform: "none", fontWeight: 600 }}>
            Mark all read
          </Button>
        )}
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 300px" }, gap: 3 }}>
        <Paper elevation={0} sx={{ borderRadius: 3, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable"
            sx={{ borderBottom: "1px solid #e2e8f0", px: 1, minHeight: 44 }}
          >
            <Tab value="all" label="All" sx={{ minHeight: 44, textTransform: "none", fontSize: "0.8rem" }} />
            <Tab value="mentions" label="Mentions" sx={{ minHeight: 44, textTransform: "none", fontSize: "0.8rem" }} />
            <Tab value="chat" label="Chat" sx={{ minHeight: 44, textTransform: "none", fontSize: "0.8rem" }} />
            <Tab value="projects" label="Projects" sx={{ minHeight: 44, textTransform: "none", fontSize: "0.8rem" }} />
            <Tab value="tasks" label="Tasks" sx={{ minHeight: 44, textTransform: "none", fontSize: "0.8rem" }} />
          </Tabs>

          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress size={22} sx={{ color: "#4f46e5" }} />
            </Box>
          ) : filtered.length === 0 ? (
            <Box sx={{ textAlign: "center", py: 6 }}>
              <Typography sx={{ fontSize: "0.85rem", color: "#94a3b8" }}>Nothing here yet.</Typography>
            </Box>
          ) : (
            filtered.map((n) => (
              <Box
                key={n.id}
                onClick={() => handleClick(n)}
                sx={{
                  px: 2.5,
                  py: 1.5,
                  cursor: "pointer",
                  borderBottom: "1px solid #f1f5f9",
                  bgcolor: n.read ? "transparent" : "#eef2ff",
                  "&:hover": { bgcolor: "#f8fafc" },
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.25 }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: TYPE_COLOR[n.type], flexShrink: 0 }} />
                  <Typography sx={{ fontSize: "0.68rem", fontWeight: 700, color: TYPE_COLOR[n.type], textTransform: "uppercase" }}>
                    {TYPE_LABEL[n.type]}
                  </Typography>
                  <Typography sx={{ fontSize: "0.7rem", color: "#94a3b8", ml: "auto" }}>{timeAgo(n.created_at)}</Typography>
                </Box>
                <Typography sx={{ fontSize: "0.86rem", fontWeight: 600 }}>{n.title}</Typography>
                {n.body && (
                  <Typography sx={{ fontSize: "0.78rem", color: "#64748b", mt: 0.25 }}>{n.body}</Typography>
                )}
              </Box>
            ))
          )}
        </Paper>

        <Paper elevation={0} sx={{ borderRadius: 3, border: "1px solid #e2e8f0", p: 2.5, height: "fit-content" }}>
          <Typography sx={{ fontWeight: 700, fontSize: "0.9rem", mb: 1.5 }}>Notification settings</Typography>

          {[
            { key: "chatSoundEnabled" as const, label: "Chat sounds" },
            { key: "mentionSoundEnabled" as const, label: "Mention notifications" },
            { key: "projectNotificationsEnabled" as const, label: "Project notifications" },
          ].map((row) => (
            <Box key={row.key} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", py: 0.75 }}>
              <Typography sx={{ fontSize: "0.82rem", color: "#334155" }}>{row.label}</Typography>
              <Switch size="small" checked={prefs[row.key]} onChange={() => togglePref(row.key)} />
            </Box>
          ))}

          <Typography sx={{ fontSize: "0.7rem", color: "#94a3b8", mt: 1.5 }}>
            Chat sounds only play for incoming chat messages and mentions — task and project updates stay silent.
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
}
