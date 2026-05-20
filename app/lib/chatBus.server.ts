import { EventBus } from 'lib/eventBus.server';

/**
 * Per-room chat broadcast. Subscribers register by roomId; senders
 * publish after the chat_message row commits.
 *
 * Why post-commit publish: same reason as broadcastBus — never let a
 * rolled-back insert leak to viewers.
 */

export type BroadcastedChatMessage = {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  body: string;
  /** ISO-8601 timestamp; the wire format is a string, not Date. */
  createdAt: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __chatBus: EventBus<BroadcastedChatMessage> | undefined;
}

if (!globalThis.__chatBus) {
  globalThis.__chatBus = new EventBus<BroadcastedChatMessage>();
}

export const chatBus = globalThis.__chatBus;
