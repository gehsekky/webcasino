import { useEffect, useRef, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { AuthenticityTokenInput } from 'remix-utils/csrf/react';
import { MAX_CHAT_BODY_LENGTH, type ChatMessage } from 'lib/chat';
import { buttonClass } from 'lib/buttonStyle';

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

type ChatPaneProps = {
  /** Room id. Used both for the SSE subscription and the form `action`. */
  roomId: string;
  /** Scrollback from the loader, oldest-first. */
  initialMessages: ChatMessage[];
  /** Viewer's user id, used to right-align their own messages. */
  viewerUserId: string;
};

/**
 * Room chat. Initial scrollback comes from the loader; new messages stream
 * in via the room's SSE channel (event type `chat_message`). Sending goes
 * through a Remix fetcher → `POST /rooms/:id` with `intent=chat`, so it
 * shares the CSRF wiring with the rest of the room actions.
 *
 * The SSE stream echoes the sender's own message back too, so we don't do
 * optimistic prepends; the round-trip is fast enough.
 */
export default function ChatPane({ roomId, initialMessages, viewerUserId }: ChatPaneProps) {
  const fetcher = useFetcher();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  // Defer timestamp rendering until after hydration. `new Date().getHours()`
  // uses the local TZ — server TZ vs. browser TZ would mismatch and break
  // hydration, which silently nukes all event handlers on the page.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  // Subscribe to the room SSE stream and merge incoming chat messages.
  // De-dupe by id in case the loader's scrollback overlaps with a freshly
  // broadcast message.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/rooms/${roomId}/events`);
    const onChat = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data) as ChatMessage;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      } catch {
        /* malformed payload — skip */
      }
    };
    es.addEventListener('chat_message', onChat as EventListener);
    return () => es.close();
  }, [roomId]);

  // Auto-scroll to the bottom when a new message arrives.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Clear the composer after a successful send.
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data && (fetcher.data as { ok?: boolean }).ok) {
      setDraft('');
    }
  }, [fetcher.state, fetcher.data]);

  const submitting = fetcher.state !== 'idle';
  const canSend = draft.trim().length > 0 && draft.length <= MAX_CHAT_BODY_LENGTH && !submitting;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (!canSend) {
      e.preventDefault();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend && formRef.current) {
        fetcher.submit(formRef.current);
      }
    }
  };

  return (
    <aside
      aria-label="Room chat"
      className="flex flex-col rounded-xl bg-emerald-900/40 ring-1 ring-emerald-700/40 h-[28rem] lg:h-[calc(100vh-7rem)]"
    >
      <header className="px-4 py-2 border-b border-emerald-700/40 text-xs uppercase tracking-wider text-emerald-200">
        Chat
      </header>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-2 text-sm"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 ? (
          <p className="italic text-emerald-200/60 text-center mt-4">No messages yet. Say hello.</p>
        ) : (
          messages.map((m) => {
            const isViewer = m.userId === viewerUserId;
            return (
              <div key={m.id} className={`flex flex-col ${isViewer ? 'items-end' : 'items-start'}`}>
                <div
                  className={`flex items-baseline gap-2 px-1 text-xs ${
                    isViewer ? 'flex-row-reverse' : ''
                  }`}
                >
                  <span
                    className={`font-semibold ${isViewer ? 'text-yellow-300' : 'text-emerald-300'}`}
                  >
                    {isViewer ? 'You' : m.userName}
                  </span>
                  <time
                    dateTime={m.createdAt}
                    className="text-emerald-200/50 tabular-nums"
                    suppressHydrationWarning
                    title={hydrated ? new Date(m.createdAt).toLocaleString() : undefined}
                  >
                    {hydrated ? formatTime(m.createdAt) : ''}
                  </time>
                </div>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-1.5 mt-0.5 ${
                    isViewer
                      ? 'bg-emerald-700 text-white'
                      : 'bg-emerald-950/70 text-emerald-100 ring-1 ring-emerald-800/60'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <fetcher.Form
        ref={formRef}
        method="post"
        action={`/rooms/${roomId}`}
        onSubmit={handleSubmit}
        className="border-t border-emerald-700/40 p-2 flex gap-2 items-end"
      >
        <AuthenticityTokenInput />
        <input type="hidden" name="intent" value="chat" />
        <label htmlFor="chat-body" className="sr-only">
          Chat message
        </label>
        <textarea
          id="chat-body"
          name="body"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          maxLength={MAX_CHAT_BODY_LENGTH}
          placeholder="Message room…"
          className="flex-1 min-w-0 resize-none bg-emerald-950 text-white rounded px-2 py-1.5 ring-1 ring-emerald-700 focus:outline-none focus:ring-2 focus:ring-yellow-400 text-sm"
        />
        <button
          type="submit"
          disabled={!canSend}
          className={buttonClass({ variant: 'primary', size: 'sm' })}
        >
          {submitting ? '…' : 'Send'}
        </button>
      </fetcher.Form>
    </aside>
  );
}
