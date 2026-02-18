import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import {
  fetchSessions,
  fetchMessages,
  type DecryptedSession,
  type MessageContent,
} from '../lib/api';
import {
  createSocket,
  sendMessage,
  decryptMessageUpdate,
  rpcCall,
  type UpdateEvent,
  type EphemeralEvent,
} from '../lib/socket';
import type { Socket } from 'socket.io-client';

export function Session() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { credentials } = useAuth();
  const navigate = useNavigate();

  const [session, setSession] = useState<DecryptedSession | null>(null);
  const [messages, setMessages] = useState<MessageContent[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [thinking, setThinking] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const sessionRef = useRef<DecryptedSession | null>(null);

  // Keep ref in sync for socket callbacks
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Load session and messages
  useEffect(() => {
    if (!credentials || !sessionId) return;

    (async () => {
      try {
        const sessions = await fetchSessions(credentials);
        const found = sessions.find((s) => s.id === sessionId);
        if (!found) {
          navigate('/');
          return;
        }
        setSession(found);
        const msgs = await fetchMessages(credentials, found);
        setMessages(msgs);
      } catch (err) {
        console.error('Failed to load session:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [credentials, sessionId, navigate]);

  // Connect socket
  useEffect(() => {
    if (!credentials || !sessionId) return;

    const socket = createSocket(
      credentials.token,
      {
        onConnect: () => setConnected(true),
        onDisconnect: () => setConnected(false),
        onUpdate: async (event) => {
          const s = sessionRef.current;
          if (!s) return;

          if (event.type === 'new-message' && event.sid === sessionId) {
            const content = await decryptMessageUpdate(
              event as Extract<UpdateEvent, { type: 'new-message' }>,
              s,
            );
            if (content) {
              setMessages((prev) => [...prev, content]);
            }
          }
        },
        onEphemeral: (event) => {
          if (event.type === 'activity' && event.id === sessionId) {
            setThinking(event.thinking);
          }
        },
      },
      { type: 'user-scoped' },
    );

    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [credentials, sessionId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !session || !socketRef.current) return;

    setInput('');

    // Optimistically add local message
    const localMsg: MessageContent = {
      role: 'user',
      content: { type: 'text', text },
      meta: { sentFrom: 'web' },
    };
    setMessages((prev) => [...prev, localMsg]);

    try {
      await sendMessage(socketRef.current, session, text);
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderMessage = (msg: MessageContent, index: number) => {
    const isUser = msg.role === 'user';
    const isEvent =
      msg.content && 'type' in msg.content && msg.content.type === 'event';
    const isOutput =
      msg.content && 'type' in msg.content && msg.content.type === 'output';

    if (isEvent) {
      const eventData = (msg.content as { type: 'event'; data: any }).data;
      return (
        <div key={index} style={styles.eventRow}>
          <span style={styles.eventText}>
            {eventData.type === 'ready'
              ? 'Agent ready'
              : eventData.type === 'message'
                ? eventData.message
                : eventData.type === 'switch'
                  ? `Switched to ${eventData.mode} mode`
                  : JSON.stringify(eventData)}
          </span>
        </div>
      );
    }

    if (isOutput) {
      const outputData = (msg.content as { type: 'output'; data: any }).data;
      return (
        <div key={index} style={styles.messageRow}>
          <div style={{ ...styles.bubble, ...styles.agentBubble }}>
            <pre style={styles.outputPre}>
              {renderOutputData(outputData)}
            </pre>
          </div>
        </div>
      );
    }

    const text =
      msg.content && 'text' in msg.content ? msg.content.text : '';
    const displayText = msg.meta && 'displayText' in msg.meta ? (msg.meta as any).displayText : null;

    return (
      <div
        key={index}
        style={{
          ...styles.messageRow,
          justifyContent: isUser ? 'flex-end' : 'flex-start',
        }}
      >
        <div
          style={{
            ...styles.bubble,
            ...(isUser ? styles.userBubble : styles.agentBubble),
          }}
        >
          <div style={styles.messageText}>
            {displayText || text || '(empty)'}
          </div>
          {msg.meta?.sentFrom && (
            <div style={styles.messageMeta}>{msg.meta.sentFrom}</div>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>Loading session...</div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate('/')}>
          &larr; Back
        </button>
        <div style={styles.headerCenter}>
          <span style={styles.headerTitle}>
            {session?.metadata?.firstMessage?.slice(0, 50) ||
              session?.metadata?.path?.split('/').pop() ||
              sessionId?.slice(0, 8)}
          </span>
          <span style={styles.headerStatus}>
            {thinking ? 'Thinking...' : connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div style={{ width: 60 }} />
      </div>

      <div style={styles.messages}>
        {messages.length === 0 ? (
          <div style={styles.empty}>No messages yet</div>
        ) : (
          messages.map((msg, i) => renderMessage(msg, i))
        )}
        {thinking && (
          <div style={styles.messageRow}>
            <div style={{ ...styles.bubble, ...styles.agentBubble }}>
              <div style={styles.thinkingDots}>
                <span style={styles.thinkingDot} />
                <span style={{ ...styles.thinkingDot, animationDelay: '0.2s' }} />
                <span style={{ ...styles.thinkingDot, animationDelay: '0.4s' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div style={styles.inputArea}>
        <textarea
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          rows={1}
        />
        <button
          style={{
            ...styles.sendBtn,
            opacity: input.trim() ? 1 : 0.4,
          }}
          onClick={handleSend}
          disabled={!input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function renderOutputData(data: any): string {
  if (!data) return '';

  // Handle Claude SDK message formats
  if (data.type === 'assistant' && data.message) {
    const msg = data.message;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .map((block: any) => {
          if (block.type === 'text') return block.text;
          if (block.type === 'tool_use')
            return `[Tool: ${block.name}]\n${JSON.stringify(block.input, null, 2)}`;
          if (block.type === 'tool_result')
            return typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content, null, 2);
          return JSON.stringify(block, null, 2);
        })
        .join('\n');
    }
  }

  if (data.type === 'user' && data.message) {
    const msg = data.message;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .map((block: any) => {
          if (block.type === 'tool_result') {
            if (typeof block.content === 'string') return `[Result] ${block.content}`;
            return `[Result] ${JSON.stringify(block.content, null, 2)}`;
          }
          return JSON.stringify(block, null, 2);
        })
        .join('\n');
    }
  }

  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  loadingContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    color: 'var(--text-secondary)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--space-md) var(--space-xl)',
    background: 'var(--bg-surface)',
    borderBottom: '1px solid var(--divider)',
    flexShrink: 0,
  },
  backBtn: {
    fontSize: 14,
    color: 'var(--text-secondary)',
    padding: 'var(--space-xs) var(--space-sm)',
    width: 60,
  },
  headerCenter: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  },
  headerStatus: {
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-tertiary)',
  },
  messages: {
    flex: 1,
    overflow: 'auto',
    padding: 'var(--space-lg) var(--space-xl)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-sm)',
  },
  empty: {
    textAlign: 'center',
    color: 'var(--text-secondary)',
    padding: '60px 0',
    fontSize: 14,
  },
  messageRow: {
    display: 'flex',
  },
  bubble: {
    maxWidth: '80%',
    padding: 'var(--space-md) var(--space-lg)',
    borderRadius: 'var(--radius-lg)',
    fontSize: 14,
    lineHeight: 1.5,
  },
  userBubble: {
    background: 'var(--accent)',
    color: 'var(--bg-surface)',
    borderBottomRightRadius: 'var(--radius-sm)',
  },
  agentBubble: {
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    borderBottomLeftRadius: 'var(--radius-sm)',
  },
  messageText: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  messageMeta: {
    fontSize: 10,
    opacity: 0.5,
    marginTop: 'var(--space-xs)',
    fontFamily: 'var(--font-mono)',
  },
  outputPre: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: 0,
    maxHeight: 400,
    overflow: 'auto',
  },
  eventRow: {
    display: 'flex',
    justifyContent: 'center',
    padding: 'var(--space-xs) 0',
  },
  eventText: {
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-tertiary)',
    background: 'var(--bg-surface)',
    padding: '2px var(--space-md)',
    borderRadius: 'var(--radius-sm)',
  },
  inputArea: {
    display: 'flex',
    gap: 'var(--space-sm)',
    padding: 'var(--space-md) var(--space-xl)',
    background: 'var(--bg-surface)',
    borderTop: '1px solid var(--divider)',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    padding: 'var(--space-md) var(--space-lg)',
    borderRadius: 'var(--radius-lg)',
    background: 'var(--bg-grouped)',
    color: 'var(--text-primary)',
    fontSize: 14,
    resize: 'none',
    minHeight: 40,
    maxHeight: 120,
    border: '1px solid var(--divider)',
  },
  sendBtn: {
    padding: 'var(--space-md) var(--space-xl)',
    borderRadius: 'var(--radius-lg)',
    background: 'var(--accent)',
    color: 'var(--bg-surface)',
    fontSize: 14,
    fontWeight: 600,
    transition: 'opacity 0.15s',
    flexShrink: 0,
  },
  thinkingDots: {
    display: 'flex',
    gap: 'var(--space-xs)',
    padding: 'var(--space-xs) 0',
  },
  thinkingDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--text-tertiary)',
    animation: 'pulse 1s ease-in-out infinite',
  },
};
