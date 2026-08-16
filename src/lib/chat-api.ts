import { supabase } from './supabase';
import type { Channel, ChatMessage } from './types';
import { notifyUsers } from './notifications-api';

// ── Channels ────────────────────────────────────────────────────────
export async function fetchChannels(): Promise<Channel[]> {
  const { data, error } = await supabase.from('channels').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createGroupChannel(name: string, memberIds: string[], createdBy: string): Promise<Channel> {
  const { data, error } = await supabase
    .from('channels')
    .insert({ type: 'group', name, created_by: createdBy })
    .select()
    .single();
  if (error) throw error;

  const ids = Array.from(new Set([...memberIds, createdBy]));
  const { error: memberError } = await supabase
    .from('channel_members')
    .insert(ids.map((user_id) => ({ channel_id: data.id, user_id })));
  if (memberError) throw memberError;

  return data;
}

export async function getOrCreateDmChannel(userId: string, otherUserId: string, otherName: string): Promise<Channel> {
  const { data: dmChannels, error } = await supabase.from('channels').select('id').eq('type', 'dm');
  if (error) throw error;
  const dmIds = (dmChannels ?? []).map((c) => c.id);

  if (dmIds.length) {
    const { data: members, error: memberError } = await supabase
      .from('channel_members')
      .select('channel_id,user_id')
      .in('channel_id', dmIds)
      .in('user_id', [userId, otherUserId]);
    if (memberError) throw memberError;

    const byChannel = new Map<string, Set<string>>();
    (members ?? []).forEach((m) => {
      const set = byChannel.get(m.channel_id) ?? new Set<string>();
      set.add(m.user_id);
      byChannel.set(m.channel_id, set);
    });
    const existingId = [...byChannel.entries()].find(([, set]) => set.has(userId) && set.has(otherUserId))?.[0];
    if (existingId) {
      const { data: existing, error: fetchError } = await supabase.from('channels').select('*').eq('id', existingId).single();
      if (fetchError) throw fetchError;
      return existing;
    }
  }

  const { data: created, error: createError } = await supabase
    .from('channels')
    .insert({ type: 'dm', name: otherName, created_by: userId })
    .select()
    .single();
  if (createError) throw createError;

  const { error: newMemberError } = await supabase.from('channel_members').insert([
    { channel_id: created.id, user_id: userId },
    { channel_id: created.id, user_id: otherUserId },
  ]);
  if (newMemberError) throw newMemberError;

  return created;
}

export async function fetchChannelMemberIds(channelId: string): Promise<string[]> {
  const { data, error } = await supabase.from('channel_members').select('user_id').eq('channel_id', channelId);
  if (error) throw error;
  return (data ?? []).map((r) => r.user_id);
}

export async function fetchAllChannelMembers(): Promise<{ channel_id: string; user_id: string }[]> {
  const { data, error } = await supabase.from('channel_members').select('channel_id,user_id');
  if (error) throw error;
  return data ?? [];
}

// ── Messages ────────────────────────────────────────────────────────
export async function fetchMessages(channelId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function sendMessage(input: {
  channelId: string;
  authorId: string;
  authorName: string;
  body: string;
  parentMessageId?: string | null;
  /**
   * Explicit user ids chosen from the @mention picker. Authoritative —
   * preferred over any text-based matching so a mention notification
   * always resolves to exactly the person selected, never to anyone
   * who merely shares a first name.
   */
  mentionedUserIds?: string[];
}): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      channel_id: input.channelId,
      author_id: input.authorId,
      body: input.body,
      parent_message_id: input.parentMessageId ?? null,
    })
    .select()
    .single();
  if (error) throw error;

  // Only actual channel members are ever eligible recipients — this
  // applies to both explicit picks and the text-matching fallback, so
  // mentioning/messaging never reaches someone outside the conversation.
  const memberIds = await fetchChannelMemberIds(input.channelId).catch(() => [] as string[]);
  const eligibleIds = new Set(memberIds.filter((id) => id !== input.authorId));

  let mentionIds = (input.mentionedUserIds ?? []).filter((id) => eligibleIds.has(id));

  // Fallback for messages typed without the picker: match "@token"
  // against first name / email prefix, but only among channel members.
  if (!mentionIds.length) {
    const tokens = Array.from(input.body.matchAll(/@(\w+)/g)).map((m) => m[1].toLowerCase());
    if (tokens.length && eligibleIds.size) {
      try {
        const { data: users } = await supabase
          .from('users')
          .select('id,email,full_name')
          .in('id', [...eligibleIds]);
        mentionIds = (users ?? [])
          .filter((u) => {
            const first = (u.full_name ?? '').split(' ')[0]?.toLowerCase();
            const prefix = u.email.split('@')[0]?.toLowerCase();
            return tokens.includes(first) || tokens.includes(prefix);
          })
          .map((u) => u.id);
      } catch {
        // best-effort — never block sending a message
      }
    }
  }

  const mentionSet = new Set(mentionIds);

  if (mentionSet.size) {
    try {
      await supabase
        .from('message_mentions')
        .insert([...mentionSet].map((mentioned_user_id) => ({ message_id: data.id, mentioned_user_id })));
      await notifyUsers([...mentionSet], {
        type: 'mention',
        title: `${input.authorName} mentioned you`,
        body: input.body.slice(0, 140),
        channel_id: input.channelId,
        conversation_id: input.channelId,
        message_id: data.id,
        sender_id: input.authorId,
      });
    } catch {
      // notifications are best-effort — never block sending a message
    }
  }

  // Everyone else in the conversation (i.e. not mentioned, not the
  // author) gets a plain chat-message notification instead.
  const restIds = [...eligibleIds].filter((id) => !mentionSet.has(id));
  if (restIds.length) {
    notifyUsers(restIds, {
      type: 'chat_message',
      title: `${input.authorName} sent a message`,
      body: input.body.slice(0, 140),
      channel_id: input.channelId,
      conversation_id: input.channelId,
      message_id: data.id,
      sender_id: input.authorId,
    }).catch(() => {
      // best-effort — never block sending a message
    });
  }

  return data;
}

export async function editMessage(id: string, body: string): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('messages')
    .update({ body, edited_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMessage(id: string): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function togglePinMessage(id: string, pinned: boolean): Promise<ChatMessage> {
  const { data, error } = await supabase.from('messages').update({ pinned }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export function subscribeToChannelMessages(channelId: string, onChange: () => void) {
  const channel = supabase
    .channel(`messages-${channelId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
      onChange
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
