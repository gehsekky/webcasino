/**
 * Shared chat types and constants. This module is import-safe from both
 * client and server code — no DB / server-only imports. Server-side
 * helpers live in `app/actions/chat.server.ts`.
 */

/**
 * Hard cap on stored chat body length. Mirrors the `@db.VarChar(500)`
 * constraint in `prisma/schema.prisma`. The server validates against
 * this; the client also wires it to the composer's `maxLength`.
 */
export const MAX_CHAT_BODY_LENGTH = 500;

export type ChatMessage = {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  body: string;
  /** ISO-8601 timestamp string. */
  createdAt: string;
};
