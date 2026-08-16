// Chat message sound — deliberately separate from the general
// notification system. Only chat_message / mention events should ever
// call playChatSound(); task/project notifications must not.

const PREFS_KEY = 'jira_clone_notification_prefs';

export interface NotificationPrefs {
  chatSoundEnabled: boolean;
  mentionSoundEnabled: boolean;
  projectNotificationsEnabled: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  chatSoundEnabled: true,
  mentionSoundEnabled: true,
  projectNotificationsEnabled: true,
};

export function getNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function setNotificationPrefs(patch: Partial<NotificationPrefs>): NotificationPrefs {
  const next = { ...getNotificationPrefs(), ...patch };
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  return next;
}

// Browsers block audio until the user has interacted with the page at
// least once. Any click/keydown anywhere unlocks it for the session.
let audioUnlocked = false;
let audioCtx: AudioContext | null = null;

function ensureUnlockListener() {
  if (typeof window === 'undefined' || audioUnlocked) return;
  const unlock = () => {
    audioUnlocked = true;
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}
ensureUnlockListener();

// Debounce so a burst of several messages arriving together plays one
// sound, not a rapid-fire stack of them.
let lastPlayedAt = 0;
const MIN_INTERVAL_MS = 1200;

function playTone() {
  if (typeof window === 'undefined') return;
  if (!audioUnlocked) return; // respect the browser autoplay restriction
  const now = Date.now();
  if (now - lastPlayedAt < MIN_INTERVAL_MS) return;
  lastPlayedAt = now;

  try {
    audioCtx = audioCtx ?? new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const ctx = audioCtx;
    const t0 = ctx.currentTime;

    // Two-note "ding" reminiscent of a phone/message chime.
    [0, 0.09].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(i === 0 ? 880 : 1175, t0 + offset);
      gain.gain.setValueAtTime(0, t0 + offset);
      gain.gain.linearRampToValueAtTime(0.16, t0 + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + offset + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.25);
    });
  } catch {
    // Audio isn't critical — never let a sound failure break chat.
  }
}

export function playChatSound() {
  if (!getNotificationPrefs().chatSoundEnabled) return;
  playTone();
}

export function playMentionSound() {
  if (!getNotificationPrefs().mentionSoundEnabled) return;
  playTone();
}
