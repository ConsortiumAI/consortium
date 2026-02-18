import React, { useState } from 'react';
import { useAuth } from '../App';
import { authenticate, resolveCredentials, getStoredCredentials } from '../lib/auth';
import { SERVER_URL } from '../lib/api';
import { initEncryption, decodeBase64 } from '../lib/encryption';
import sodium from 'libsodium-wrappers';

export function Login() {
  const { setCredentials } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [secretInput, setSecretInput] = useState('');

  const handleNewAccount = async () => {
    setLoading(true);
    setError(null);
    try {
      await initEncryption();
      const stored = await authenticate(SERVER_URL);
      const creds = await resolveCredentials(stored);
      setCredentials(creds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleExistingAccount = async () => {
    if (!secretInput.trim()) {
      setError('Please enter your secret key');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await initEncryption();
      const secret = sodium.from_base64(
        secretInput.trim(),
        sodium.base64_variants.ORIGINAL,
      );
      const stored = await authenticate(SERVER_URL, secret);
      const creds = await resolveCredentials(stored);
      setCredentials(creds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>consortium</div>
        <div style={styles.subtitle}>E2EE Claude Code Relay</div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.tabs}>
          <button
            style={{
              ...styles.tab,
              ...(mode === 'new' ? styles.tabActive : {}),
            }}
            onClick={() => setMode('new')}
          >
            New Account
          </button>
          <button
            style={{
              ...styles.tab,
              ...(mode === 'existing' ? styles.tabActive : {}),
            }}
            onClick={() => setMode('existing')}
          >
            Existing Account
          </button>
        </div>

        {mode === 'new' ? (
          <div style={styles.section}>
            <p style={styles.hint}>
              Generate a new keypair and authenticate. Save the secret key shown
              after login to access your account from other devices.
            </p>
            <button
              style={styles.button}
              onClick={handleNewAccount}
              disabled={loading}
            >
              {loading ? 'Authenticating...' : 'Create Account'}
            </button>
          </div>
        ) : (
          <div style={styles.section}>
            <p style={styles.hint}>
              Enter the base64 secret key from your CLI or another device.
            </p>
            <input
              style={styles.input}
              type="password"
              placeholder="Base64 secret key..."
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleExistingAccount()}
            />
            <button
              style={styles.button}
              onClick={handleExistingAccount}
              disabled={loading}
            >
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    padding: 'var(--space-xl)',
  },
  card: {
    background: 'var(--bg-surface)',
    borderRadius: 'var(--radius-xl)',
    padding: '40px',
    width: '100%',
    maxWidth: 420,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  logo: {
    fontFamily: 'var(--font-logo)',
    fontSize: 28,
    fontWeight: 700,
    textAlign: 'center' as const,
    marginBottom: 'var(--space-xs)',
  },
  subtitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    color: 'var(--text-secondary)',
    textAlign: 'center' as const,
    marginBottom: 'var(--space-3xl)',
  },
  tabs: {
    display: 'flex',
    gap: 'var(--space-sm)',
    marginBottom: 'var(--space-xl)',
  },
  tab: {
    flex: 1,
    padding: 'var(--space-sm) var(--space-md)',
    borderRadius: 'var(--radius-md)',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    background: 'var(--bg-grouped)',
    transition: 'all 0.15s',
  },
  tabActive: {
    color: 'var(--text-primary)',
    background: 'var(--bg-elevated)',
    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
  },
  section: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 'var(--space-md)',
  },
  hint: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  },
  input: {
    width: '100%',
    padding: 'var(--space-md) var(--space-lg)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-grouped)',
    color: 'var(--text-primary)',
    fontSize: 14,
    fontFamily: 'var(--font-mono)',
    border: '1px solid var(--divider)',
  },
  button: {
    width: '100%',
    padding: 'var(--space-md) var(--space-xl)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--accent)',
    color: 'var(--bg-surface)',
    fontSize: 14,
    fontWeight: 600,
    transition: 'opacity 0.15s',
  },
  error: {
    background: '#FF3B3015',
    color: 'var(--error)',
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    fontSize: 13,
    marginBottom: 'var(--space-lg)',
  },
};
