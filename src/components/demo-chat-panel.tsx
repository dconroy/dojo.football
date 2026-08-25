"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { demoFetch as fetch } from "@/lib/demo-tab-session";

interface ChatMessage {
  id: string;
  authorName: string;
  authorSlot: number;
  kind: "text" | "gif";
  content: string;
  gifUrl: string | null;
  gifAlt: string | null;
  createdAt: string;
}

interface GiphyGif {
  id: string;
  title: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const merged = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) merged.set(message.id, message);
  return [...merged.values()]
    .filter((message) => Date.now() - Date.parse(message.createdAt) < 60 * 60 * 1000)
    .sort(
      (left, right) =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
        left.id.localeCompare(right.id),
    )
    .slice(-100);
}

export function DemoChatPanel({
  roomId,
  canPost,
  currentSlot,
}: {
  roomId: string;
  canPost: boolean;
  currentSlot: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [gifOpen, setGifOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [gifStatus, setGifStatus] = useState("");
  const messagesRef = useRef(messages);
  const openRef = useRef(open);
  const initializedRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    openRef.current = open;
    if (open) setUnread(0);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const content = contentRef.current;
    if (!list || !content) return;
    const stickToBottom = () => {
      list.scrollTop = list.scrollHeight;
    };
    stickToBottom();
    const frame = requestAnimationFrame(stickToBottom);
    const observer = new ResizeObserver(stickToBottom);
    observer.observe(content);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [messages, open]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      if (document.hidden) {
        timer = setTimeout(load, 5000);
        return;
      }
      const latest = messagesRef.current.at(-1)?.createdAt;
      const params = new URLSearchParams({ draftId: roomId });
      if (latest) params.set("after", latest);
      try {
        const response = await fetch(`/api/demo/chat?${params}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as {
          messages?: ChatMessage[];
          error?: string;
        };
        if (!response.ok) throw new Error(body.error ?? "Chat unavailable");
        if (!cancelled && body.messages?.length) {
          setMessages((current) => mergeMessages(current, body.messages ?? []));
          if (initializedRef.current && !openRef.current) {
            setUnread((count) => count + body.messages!.length);
          }
        }
        initializedRef.current = true;
        if (!cancelled) setError("");
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Chat unavailable");
        }
      } finally {
        if (!cancelled) timer = setTimeout(load, openRef.current ? 3000 : 5000);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [roomId]);

  useEffect(() => {
    if (!gifOpen || gifQuery.trim().length < 2) {
      setGifs([]);
      setGifStatus("");
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setGifStatus("Searching…");
      try {
        const params = new URLSearchParams({
          draftId: roomId,
          q: gifQuery.trim(),
        });
        const response = await fetch(`/api/demo/giphy?${params}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as {
          gifs?: GiphyGif[];
          error?: string;
        };
        if (!response.ok) throw new Error(body.error ?? "GIF search failed");
        if (!cancelled) {
          setGifs(body.gifs ?? []);
          setGifStatus(body.gifs?.length ? "" : "No GIFs found");
        }
      } catch (searchError) {
        if (!cancelled) {
          setGifs([]);
          setGifStatus(
            searchError instanceof Error ? searchError.message : "GIF search failed",
          );
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [gifOpen, gifQuery, roomId]);

  const latestLabel = useMemo(() => {
    const latest = messages.at(-1);
    return latest ? `${latest.authorName}: ${latest.kind === "gif" ? "GIF" : latest.content}` : "";
  }, [messages]);

  async function sendMessage(input: {
    kind: "text" | "gif";
    content?: string;
    gifUrl?: string;
    gifAlt?: string;
  }) {
    if (!canPost || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/demo/chat?draftId=${encodeURIComponent(roomId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const body = (await response.json()) as {
        message?: ChatMessage;
        error?: string;
      };
      if (!response.ok || !body.message) {
        throw new Error(body.error ?? "Message failed");
      }
      setMessages((current) => mergeMessages(current, [body.message!]));
      setText("");
      setGifOpen(false);
      setGifQuery("");
      setGifs([]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Message failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <aside className={`demo-chat ${open ? "open" : ""}`} aria-label="Demo room chat">
      <button
        className="demo-chat-toggle"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span>
          <strong>Room chat</strong>
          {!open && latestLabel ? <small>{latestLabel}</small> : null}
        </span>
        {unread > 0 ? <b>{Math.min(unread, 99)}</b> : null}
        <i>{open ? "×" : "Chat"}</i>
      </button>

      {open ? (
        <>
          <div className="demo-chat-messages" ref={listRef}>
            <div className="demo-chat-message-list" ref={contentRef}>
              {messages.length === 0 ? (
                <p className="demo-chat-empty">
                  No messages yet. Talk some trash before the clock starts.
                </p>
              ) : (
                messages.map((message) => (
                  <article
                    className={
                      currentSlot === message.authorSlot ? "demo-chat-message mine" : "demo-chat-message"
                    }
                    key={message.id}
                  >
                    <header>
                      <strong>{message.authorName}</strong>
                      <span>
                        Slot {message.authorSlot} ·{" "}
                        {new Date(message.createdAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </header>
                    {message.kind === "gif" && message.gifUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- GIPHY returns dynamic media hosts.
                      <img src={message.gifUrl} alt={message.gifAlt ?? "GIPHY GIF"} />
                    ) : (
                      <p>{message.content}</p>
                    )}
                  </article>
                ))
              )}
            </div>
          </div>

          {gifOpen && canPost ? (
            <div className="demo-gif-picker">
              <div className="demo-gif-search">
                <input
                  value={gifQuery}
                  maxLength={50}
                  autoFocus
                  placeholder="Search GIPHY"
                  onChange={(event) => setGifQuery(event.target.value)}
                />
                <button type="button" onClick={() => setGifOpen(false)}>
                  Close
                </button>
              </div>
              {gifStatus ? <p>{gifStatus}</p> : null}
              <div className="demo-gif-results">
                {gifs.map((gif) => (
                  <button
                    type="button"
                    key={gif.id}
                    title={gif.title}
                    disabled={sending}
                    onClick={() =>
                      void sendMessage({
                        kind: "gif",
                        gifUrl: gif.url,
                        gifAlt: gif.title,
                      })
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- GIPHY returns dynamic media hosts. */}
                    <img src={gif.previewUrl} alt={gif.title} loading="lazy" />
                  </button>
                ))}
              </div>
              <small>Powered by GIPHY</small>
            </div>
          ) : null}

          <form
            className="demo-chat-compose"
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage({ kind: "text", content: text });
            }}
          >
            {canPost ? (
              <>
                <button
                  type="button"
                  className="secondary"
                  aria-label="Search GIFs"
                  onClick={() => setGifOpen((value) => !value)}
                >
                  GIF
                </button>
                <input
                  value={text}
                  maxLength={280}
                  placeholder="Message the room"
                  onChange={(event) => setText(event.target.value)}
                />
                <button type="submit" disabled={sending || !text.trim()}>
                  Send
                </button>
              </>
            ) : (
              <p>Choose a seat to join the chat.</p>
            )}
          </form>
          {error ? <p className="demo-chat-error">{error}</p> : null}
        </>
      ) : null}
    </aside>
  );
}
