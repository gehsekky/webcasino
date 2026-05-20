import { prisma } from 'db.server';
import { chatBus, type BroadcastedChatMessage } from 'lib/chatBus.server';
import { MAX_CHAT_BODY_LENGTH, type ChatMessage } from 'lib/chat';

export { MAX_CHAT_BODY_LENGTH, type ChatMessage };

/**
 * Send a chat message to a room. Caller must already have verified the
 * sender's room membership (we don't redo it here because the route layer
 * does the same `requireUser` + seat check for game actions).
 *
 * Persists the row, then publishes on `chatBus` post-commit so any SSE
 * subscribers attached to this roomId pick it up.
 */
export async function sendChatMessage(params: {
  roomId: string;
  userId: string;
  body: string;
}): Promise<ChatMessage> {
  const trimmed = params.body.trim();
  if (trimmed.length === 0) {
    throw new Response('chat message cannot be empty', { status: 400 });
  }
  if (trimmed.length > MAX_CHAT_BODY_LENGTH) {
    throw new Response(`chat message exceeds ${MAX_CHAT_BODY_LENGTH} character limit`, {
      status: 400,
    });
  }

  const row = await prisma.chat_message.create({
    data: {
      table_id: params.roomId,
      user_id: params.userId,
      body: trimmed,
    },
    include: { user: { select: { name: true } } },
  });

  const message: ChatMessage = {
    id: row.id,
    roomId: row.table_id,
    userId: row.user_id,
    userName: row.user.name,
    body: row.body,
    createdAt: row.created_at.toISOString(),
  };

  const wire: BroadcastedChatMessage = { ...message };
  chatBus.publish(params.roomId, wire);

  return message;
}

/**
 * Fetch the most recent `limit` messages at a room, oldest-first (so the
 * list renders top-to-bottom in chronological order). The query orders by
 * `created_at DESC` to use the existing index, then reverses in memory.
 */
export async function listRecentMessages(roomId: string, limit = 50): Promise<ChatMessage[]> {
  const rows = await prisma.chat_message.findMany({
    where: { table_id: roomId },
    orderBy: { created_at: 'desc' },
    take: limit,
    include: { user: { select: { name: true } } },
  });
  return rows.reverse().map((r) => ({
    id: r.id,
    roomId: r.table_id,
    userId: r.user_id,
    userName: r.user.name,
    body: r.body,
    createdAt: r.created_at.toISOString(),
  }));
}
