import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import {
  fetchSessions,
  deleteSession,
  type DecryptedSession,
} from '../lib/api';
import {
  createSocket,
  type UpdateEvent,
  type EphemeralEvent,
} from '../lib/socket';
import { decodeBase64, decrypt } from '../lib/encryption';
import type { Socket } from 'socket.io-client';

export function Home() {
  const { credentials, logout } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<DecryptedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [activity, setActivity] = useState<
    Map<string, { active: boolean; thinking: boolean; activeAt: number }>
  >(new Map());
  const [showSecret, setShowSecret] = useState(false);

  const loadSessions = useCallback(async () => {
    if (!credentials) return;
    try {
      const data = await fetchSessions(credentials);
      setSessions(data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  }, [credentials]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!credentials) return;

    const socket = createSocket(credentials.token, {
      onConnect: () => setConnected(true),
      onDisconnect: () => setConnected(false),
      onUpdate: (event) => {
        if (event.type === 'new-session' || event.type === 'update-session' || event.type === 'delete-session') {
          // Reload sessions list on any session change
          loadSessions();
        }
      },
      onEphemeral: (event) => {
        if (event.type === 'activity') {
          setActivity((prev) => {
            const next = new Map(prev);
            next.set(event.id, {
              active: event.active,
              thinking: event.thinking,
              activeAt: event.activeAt,
            });
            return next;
          });
        }
      },
    });

    return () => {
      socket.disconnect();
    };
  }, [credentials, loadSessions]);

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!credentials || !confirm('Delete this session?')) return;
    try {
      await deleteSession(credentials, sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const getSecretKey = (): string => {
    if (!credentials) return '';
    const sodium = (window as any).sodium;
    if (sodium) {
      return sodium.to_base64(credentials.secret, sodium.base64_variants.ORIGINAL);
    }
    return btoa(String.fromCharCode(...credentials.secret));
  };

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.logo}>consortium</span>
          <span style={styles.status}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div style={styles.headerRight}>
          <button style={styles.headerBtn} onClick={() => setShowSecret(!showSecret)}>
            {showSecret ? 'Hide Key' : 'Show Key'}
          </button>
          <button style={styles.headerBtn} onClick={logout}>
            Sign Out
          </button>
        </div>
      </div>

      {showSecret && (
        <div style={styles.secretBanner}>
          <span style={styles.secretLabel}>Secret Key (save this):</span>
          <code
            style={styles.secretValue}
            onClick={() => navigator.clipboard.writeText(getSecretKey())}
            title="Click to copy"
          >
            {getSecretKey()}
          </code>
        </div>
      )}

      <div style={styles.content}>
        <h2 style={styles.title}>Sessions</h2>

        {loading ? (
          <div style={styles.empty}>Loading sessions...</div>
        ) : sessions.length === 0 ? (
          <div style={styles.empty}>
            No sessions yet. Start a consortium-cli instance to create one.
          </div>
        ) : (
          <div style={styles.list}>
            {sessions.map((session) => {
              const act = activity.get(session.id);
              const isActive = act?.active ?? session.active;
              const isThinking = act?.thinking ?? false;

              return (
                <div
                  key={session.id}
                  style={styles.card}
                  onClick={() => navigate(`/session/${session.id}`)}
                >
                  <div style={styles.cardHeader}>
                    <div style={styles.cardLeft}>
                      <span
                        style={{
                          ...styles.dot,
                          background: isActive
                            ? isThinking
                              ? 'var(--warning)'
                              : 'var(--success)'
                            : 'var(--text-tertiary)',
                        }}
                      />
                      <span style={styles.cardTitle}>
                        {session.metadata?.firstMessage ||
                          session.metadata?.path?.split('/').pop() ||
                          session.id.slice(0, 8)}
                      </span>
                    </div>
                    <div style={styles.cardRight}>
                      <span style={styles.cardTime}>
                        {formatTime(act?.activeAt ?? session.activeAt ?? session.updatedAt)}
                      </span>
                      <button
                        style={styles.deleteBtn}
                        onClick={(e) => handleDelete(e, session.id)}
                        title="Delete session"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                  <div style={styles.cardMeta}>
                    {session.metadata?.host && (
                      <span style={styles.metaTag}>{session.metadata.host}</span>
                    )}
                    {session.metadata?.path && (
                      <span style={styles.metaTag}>{session.metadata.path}</span>
                    )}
                    {session.metadata?.lifecycleState && (
                      <span style={styles.metaTag}>
                        {session.metadata.lifecycleState}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--space-lg) var(--space-xl)',
    background: 'var(--bg-surface)',
    borderBottom: '1px solid var(--divider)',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-md)',
  },
  logo: {
    fontFamily: 'var(--font-logo)',
    fontSize: 18,
    fontWeight: 700,
  },
  status: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },
  headerRight: {
    display: 'flex',
    gap: 'var(--space-sm)',
  },
  headerBtn: {
    padding: 'var(--space-xs) var(--space-md)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 12,
    color: 'var(--text-secondary)',
    background: 'var(--bg-grouped)',
  },
  secretBanner: {
    padding: 'var(--space-md) var(--space-xl)',
    background: 'var(--bg-elevated)',
    borderBottom: '1px solid var(--divider)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-md)',
    flexShrink: 0,
  },
  secretLabel: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
  },
  secretValue: {
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-primary)',
    background: 'var(--bg-grouped)',
    padding: 'var(--space-xs) var(--space-sm)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: 'var(--space-xl)',
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    marginBottom: 'var(--space-lg)',
  },
  empty: {
    textAlign: 'center',
    color: 'var(--text-secondary)',
    padding: '60px var(--space-xl)',
    fontSize: 14,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-sm)',
  },
  card: {
    background: 'var(--bg-surface)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-lg)',
    cursor: 'pointer',
    transition: 'background 0.1s',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 'var(--space-sm)',
  },
  cardLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    flex: 1,
    minWidth: 0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cardRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    flexShrink: 0,
  },
  cardTime: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    fontFamily: 'var(--font-mono)',
  },
  deleteBtn: {
    fontSize: 18,
    lineHeight: 1,
    color: 'var(--text-tertiary)',
    padding: 'var(--space-xs)',
  },
  cardMeta: {
    display: 'flex',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  metaTag: {
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-tertiary)',
    background: 'var(--bg-grouped)',
    padding: '2px var(--space-sm)',
    borderRadius: 'var(--radius-sm)',
    maxWidth: 200,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
};
