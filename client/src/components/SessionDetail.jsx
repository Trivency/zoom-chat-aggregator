import React, { useState, useEffect, useCallback } from 'react';

const API_URL = import.meta.env.DEV
  ? 'http://localhost:3001'
  : window.location.origin;

/**
 * Detail view for one (past or current) session, rendered inside the
 * Past Sessions modal: an Overview tab (after-event report — totals,
 * per-room breakdown, volume timeline, top chatters) and a Messages tab
 * (read-only browser over the full persisted chat log, "Load older"
 * pagination). Data comes from /api/sessions/:id/stats and
 * /api/sessions/:id/messages.
 */
function SessionDetail({ session, onBack }) {
  const [tab, setTab] = useState('overview');

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/10">
        <button
          onClick={onBack}
          className="px-2 py-1 rounded text-sm hover:bg-white/10 transition-colors"
          style={{ color: 'var(--text-color)' }}
          title="Back to session list"
        >
          ← Back
        </button>
        <span className="font-medium truncate" style={{ color: 'var(--text-color)' }}>
          {session.name}
        </span>
        <div className="ml-auto flex rounded-lg overflow-hidden border border-white/10">
          {[['overview', 'Overview'], ['messages', 'Messages']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1 text-sm transition-colors ${tab === key ? 'bg-white/15' : 'hover:bg-white/5'}`}
              style={{ color: 'var(--text-color)' }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'overview'
        ? <SessionStats sessionId={session.id} />
        : <SessionMessages sessionId={session.id} />}
    </div>
  );
}

// ---------- Overview (stats report) ----------

function SessionStats({ sessionId }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/sessions/${encodeURIComponent(sessionId)}/stats`, {
          credentials: 'include',
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled) setStats(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  if (error) return <PanelNotice text={`Couldn't load stats: ${error}`} />;
  if (!stats) return <PanelNotice text="Loading…" />;

  const { totals, byRoom, topSenders, timeline } = stats;
  const maxRoom = Math.max(1, ...byRoom.map(r => r.count));
  const maxBucket = Math.max(1, ...timeline.map(b => b.count));

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <StatTile label="Messages" value={totals.total} />
        <StatTile label="Attendee chat" value={totals.chat} />
        <StatTile label="Sent by us" value={totals.outbound} />
        <StatTile label="Saved" value={totals.saved} />
        <StatTile label="Chatters" value={totals.uniqueSenders} />
        <StatTile label="Rooms" value={totals.rooms} />
      </div>

      {timeline.length > 0 && (
        <section>
          <SectionLabel text="Message volume (5-min intervals)" />
          <div className="flex items-end gap-px h-24 rounded-lg p-2" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
            {timeline.map((b) => (
              <div
                key={b.bucket}
                className="flex-1 rounded-t-sm min-w-[2px]"
                style={{
                  height: `${Math.max(4, (b.count / maxBucket) * 100)}%`,
                  backgroundColor: 'var(--accent-color)',
                }}
                title={`${formatTime(b.bucket)} — ${b.count} message${b.count === 1 ? '' : 's'}`}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs opacity-50 mt-1" style={{ color: 'var(--text-color)' }}>
            <span>{formatTime(timeline[0].bucket)}</span>
            <span>peak {maxBucket}/5min</span>
            <span>{formatTime(timeline[timeline.length - 1].bucket)}</span>
          </div>
        </section>
      )}

      {byRoom.length > 0 && (
        <section>
          <SectionLabel text="Messages by room" />
          <div className="space-y-1.5">
            {byRoom.map((r) => (
              <div key={r.room} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-color)' }}>
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: r.roomColor || '#ef4444' }}
                />
                <span className="w-40 truncate" title={r.room}>{r.room}</span>
                <div className="flex-1 h-3 rounded overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${(r.count / maxRoom) * 100}%`,
                      backgroundColor: r.roomColor || '#ef4444',
                    }}
                  />
                </div>
                <span className="w-12 text-right tabular-nums opacity-70">{r.count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {topSenders.length > 0 && (
        <section>
          <SectionLabel text="Top chatters" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            {topSenders.map((s, i) => (
              <div key={s.sender} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-color)' }}>
                <span className="w-5 text-right tabular-nums opacity-40">{i + 1}.</span>
                <span className="flex-1 truncate" title={s.sender}>{s.sender}</span>
                <span className="tabular-nums opacity-70">{s.count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {totals.total === 0 && <PanelNotice text="No messages were captured in this session." />}
    </div>
  );
}

function StatTile({ label, value }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
      <div className="text-lg font-bold tabular-nums" style={{ color: 'var(--text-color)' }}>
        {Number(value).toLocaleString()}
      </div>
      <div className="text-xs opacity-60" style={{ color: 'var(--text-color)' }}>{label}</div>
    </div>
  );
}

// ---------- Messages (read-only browser) ----------

function SessionMessages({ sessionId }) {
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPage = useCallback(async (before) => {
    const params = new URLSearchParams({ limit: '200' });
    if (before) params.set('before', before);
    const res = await fetch(
      `${API_URL}/api/sessions/${encodeURIComponent(sessionId)}/messages?${params}`,
      { credentials: 'include' }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await fetchPage(null);
        if (cancelled) return;
        setMessages(data.messages);
        setHasMore(data.hasMore);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchPage]);

  const loadOlder = async () => {
    const oldest = messages[messages.length - 1];
    if (!oldest) return;
    setLoading(true);
    try {
      const data = await fetchPage(oldest.timestamp);
      setMessages(prev => [...prev, ...data.messages]);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (error) return <PanelNotice text={`Couldn't load messages: ${error}`} />;
  if (loading && messages.length === 0) return <PanelNotice text="Loading…" />;
  if (messages.length === 0) return <PanelNotice text="No messages were captured in this session." />;

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-1">
      {messages.map((m) => (
        <div key={m.id} className="flex items-baseline gap-2 text-sm rounded px-2 py-1 hover:bg-white/5" style={{ color: 'var(--text-color)' }}>
          <span className="text-xs opacity-40 tabular-nums flex-shrink-0 w-14">{formatTime(m.timestamp)}</span>
          <span
            className="text-xs px-1.5 py-0.5 rounded flex-shrink-0 max-w-[8rem] truncate"
            style={{ backgroundColor: `${m.roomColor || '#ef4444'}33`, color: 'var(--text-color)' }}
            title={m.room}
          >
            {m.room}
          </span>
          <span className="font-medium flex-shrink-0">{m.sender}:</span>
          <span className="opacity-90 break-words min-w-0">
            {m.content}
            {m.type !== 'chat' && (
              <span className="ml-1.5 text-xs opacity-50">
                {m.type === 'broadcast' ? '📢 broadcast' : m.type === 'ai_reply' ? '🤖 auto-reply' : '↩ reply'}
              </span>
            )}
            {m.saved && <span className="ml-1.5 text-xs opacity-50">🔖</span>}
          </span>
        </div>
      ))}
      {hasMore && (
        <div className="pt-2 pb-1 text-center">
          <button
            onClick={loadOlder}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-sm hover:bg-white/10 transition-colors disabled:opacity-50"
            style={{ color: 'var(--accent-color)' }}
          >
            {loading ? 'Loading…' : 'Load older messages'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- shared bits ----------

function SectionLabel({ text }) {
  return (
    <div className="text-xs uppercase tracking-wide opacity-50 mb-2" style={{ color: 'var(--text-color)' }}>
      {text}
    </div>
  );
}

function PanelNotice({ text }) {
  return (
    <div className="flex-1 p-8 text-center opacity-60" style={{ color: 'var(--text-color)' }}>
      {text}
    </div>
  );
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default SessionDetail;
