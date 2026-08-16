import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  ToggleButtonGroup,
  ToggleButton,
  Select,
  MenuItem,
  Checkbox,
  ListItemText,
  OutlinedInput,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { iconFor } from "@/lib/icons";
import { PROJECT_ICONS, PROJECT_COLORS } from "@/lib/constants";
import type { LucideIcon } from "lucide-react";
import type { Profile, Team } from "@/lib/types";

interface ProjectDialogProps {
  open: boolean;
  onClose: () => void;
  teams: Team[];
  profiles: Profile[];
  onSubmit: (data: {
    key: string;
    name: string;
    description: string;
    icon: string;
    color: string;
    team_id: string;
    lead_id: string | null;
    memberIds: string[];
  }) => void;
}

export default function ProjectDialog({ open, onClose, teams, profiles, onSubmit }: ProjectDialogProps) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("box");
  const [color, setColor] = useState("#4f46e5");
  const [teamId, setTeamId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);

  useEffect(() => {
    if (open && teams.length && !teamId) setTeamId(teams[0].id);
  }, [open, teams, teamId]);

  // A project belongs to exactly one team — candidate members/leads are
  // scoped to that team's roster so you can't accidentally staff a
  // project with people from a different team.
  const teamProfiles = useMemo(() => profiles.filter((p) => p.team_id === teamId), [profiles, teamId]);

  function reset() {
    setKey("");
    setName("");
    setDescription("");
    setIcon("box");
    setColor("#4f46e5");
    setLeadId("");
    setMemberIds([]);
  }

  function handleSubmit() {
    if (!key.trim() || !name.trim() || !teamId) return;
    onSubmit({
      key: key.trim().toUpperCase().slice(0, 4),
      name: name.trim(),
      description: description.trim(),
      icon,
      color,
      team_id: teamId,
      lead_id: leadId || null,
      memberIds,
    });
    reset();
    onClose();
  }

  const labelSx = { fontSize: "0.75rem", fontWeight: 600, color: "#64748b", mb: 0.75, textTransform: "uppercase" as const, letterSpacing: "0.04em" };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}>
      <DialogTitle sx={{ fontWeight: 600, fontSize: "1rem", pb: 1 }}>Create New Project</DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 2, mb: 2 }}>
          <Box>
            <Typography sx={labelSx}>Key</Typography>
            <TextField
              fullWidth
              size="small"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
              placeholder="ENG"
              slotProps={{ htmlInput: { maxLength: 4 } }}
            />
          </Box>
          <Box>
            <Typography sx={labelSx}>Project Name *</Typography>
            <TextField fullWidth size="small" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Awesome Project" />
          </Box>
        </Box>

        <Typography sx={labelSx}>Description</Typography>
        <TextField
          fullWidth
          multiline
          minRows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this project about?"
          sx={{ mb: 2 }}
        />

        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mb: 2 }}>
          <Box>
            <Typography sx={labelSx}>Team *</Typography>
            <Select
              fullWidth
              size="small"
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value);
                setLeadId("");
                setMemberIds([]);
              }}
              displayEmpty
            >
              {teams.length === 0 && (
                <MenuItem value="" disabled>
                  Create a team first
                </MenuItem>
              )}
              {teams.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </Select>
            <Typography sx={{ fontSize: "0.68rem", color: "#94a3b8", mt: 0.5 }}>A project belongs to exactly one team.</Typography>
          </Box>
          <Box>
            <Typography sx={labelSx}>Project Lead</Typography>
            <Select fullWidth size="small" value={leadId} onChange={(e) => setLeadId(e.target.value)} displayEmpty disabled={!teamId}>
              <MenuItem value="">No lead</MenuItem>
              {teamProfiles.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.full_name ?? p.email}
                </MenuItem>
              ))}
            </Select>
          </Box>
        </Box>

        <Typography sx={labelSx}>Project Members</Typography>
        <Select
          fullWidth
          size="small"
          multiple
          displayEmpty
          disabled={!teamId}
          value={memberIds}
          onChange={(e) => setMemberIds(typeof e.target.value === "string" ? e.target.value.split(",") : e.target.value)}
          input={<OutlinedInput />}
          renderValue={(selected) =>
            (selected as string[]).length === 0
              ? "No members selected"
              : (selected as string[])
                  .map((id) => teamProfiles.find((p) => p.id === id)?.full_name ?? teamProfiles.find((p) => p.id === id)?.email)
                  .join(", ")
          }
          sx={{ mb: 2 }}
        >
          {teamProfiles.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              <Checkbox size="small" checked={memberIds.includes(p.id)} />
              <ListItemText primary={p.full_name ?? p.email} />
            </MenuItem>
          ))}
          {teamProfiles.length === 0 && (
            <MenuItem disabled value="">
              No users on this team yet
            </MenuItem>
          )}
        </Select>

        <Typography sx={labelSx}>Icon</Typography>
        <ToggleButtonGroup
          exclusive
          value={icon}
          onChange={(_, v) => v && setIcon(v)}
          sx={{
            mb: 2,
            flexWrap: "wrap",
            gap: 0.5,
            "& .MuiToggleButtonGroup-grouped": { border: "none", borderRadius: "8px !important" },
            "& .MuiToggleButton-root": {
              width: 40,
              height: 40,
              p: 0,
              color: "#64748b",
              bgcolor: "#f1f5f9",
              "&.Mui-selected": { bgcolor: "#eef2ff", color: "#4f46e5" },
              "&:hover": { bgcolor: "#e2e8f0" },
            },
          }}
        >
          {PROJECT_ICONS.map((ic) => {
            const Icon = iconFor(ic) as LucideIcon;
            return (
              <ToggleButton key={ic} value={ic}>
                <Icon size={18} />
              </ToggleButton>
            );
          })}
        </ToggleButtonGroup>

        <Typography sx={labelSx}>Color</Typography>
        <ToggleButtonGroup
          exclusive
          value={color}
          onChange={(_, v) => v && setColor(v)}
          sx={{
            gap: 0.5,
            "& .MuiToggleButtonGroup-grouped": { border: "none", borderRadius: "50% !important" },
            "& .MuiToggleButton-root": { width: 32, height: 32, p: 0, border: "none", "&.Mui-selected": { outline: "3px solid #4f46e5", outlineOffset: 2 } },
          }}
        >
          {PROJECT_COLORS.map((c) => (
            <ToggleButton key={c} value={c} sx={{ bgcolor: c, "&:hover": { bgcolor: c, opacity: 0.85 } }} />
          ))}
        </ToggleButtonGroup>
      </DialogContent>

      <DialogActions sx={{ p: 2, pt: 0 }}>
        <Button onClick={onClose} sx={{ color: "#64748b" }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!key.trim() || !name.trim() || !teamId}
          sx={{ bgcolor: "#4f46e5", "&:hover": { bgcolor: "#4338ca" }, borderRadius: 2 }}
        >
          Create Project
        </Button>
      </DialogActions>
    </Dialog>
  );
}
