import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

function renderError(message: string) {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'monospace', padding: '2rem',
      background: '#0f172a', color: '#f8fafc',
    }}>
      <h1 style={{ color: '#ef4444', marginBottom: '1rem' }}>
        ⚠ Sanad 360 — startup error
      </h1>
      <pre style={{
        background: '#1e293b', padding: '1.5rem', borderRadius: '8px',
        whiteSpace: 'pre-wrap', maxWidth: '640px', color: '#fbbf24', fontSize: '13px',
      }}>
        {message}
      </pre>
      <p style={{
        marginTop: '1rem', color: '#94a3b8',
        maxWidth: '640px', textAlign: 'center', fontSize: '14px',
      }}>
        Copy <strong style={{ color: '#e2e8f0' }}>.env.example</strong> to{' '}
        <strong style={{ color: '#e2e8f0' }}>.env</strong> and fill in your
        Supabase keys, then restart the dev server.
      </p>
    </div>
  );
}

// Dynamic import so that module-level throws (e.g. missing VITE_SUPABASE_URL)
// are caught here and shown as a readable message instead of a blank screen.
async function main() {
  try {
    const { default: App } = await import('./App');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    renderError(message);
  }
}

main();
