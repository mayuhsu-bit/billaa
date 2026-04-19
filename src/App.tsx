import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [tokens, setTokens] = useState<string | null>(localStorage.getItem('gmail_tokens'));

  const checkAuth = async () => {
    try {
      const headers: Record<string, string> = {};
      if (tokens) {
        headers['Authorization'] = `Bearer ${tokens}`;
      }
      const res = await fetch('/api/gmail/messages', { headers });
      if (res.ok) {
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
      }
    } catch (err) {
      setIsAuthenticated(false);
    }
  };

  useEffect(() => {
    console.log("App mounted, checking auth...");
    checkAuth();

    // 1. Listen for postMessage (Fastest)
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        console.log("OAuth success via postMessage!");
        const tokenData = typeof event.data.tokens === 'string'
          ? event.data.tokens
          : JSON.stringify(event.data.tokens);
        localStorage.setItem('gmail_tokens', tokenData);
        setTokens(tokenData);
        setIsAuthenticated(true);
      }
    };

    // 2. Aggressive Polling fallback (Most reliable in iframes)
    const pollInterval = setInterval(() => {
      const syncToken = localStorage.getItem('gmail_tokens_sync');
      if (syncToken) {
        console.log("OAuth success detected via polling!");
        localStorage.setItem('gmail_tokens', syncToken);
        localStorage.removeItem('gmail_tokens_sync');
        setTokens(syncToken);
        setIsAuthenticated(true);
      }
    }, 500);

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      clearInterval(pollInterval);
    };
  }, []);

  // Watch for token changes to re-check auth if needed
  useEffect(() => {
    if (tokens && !isAuthenticated) {
      checkAuth();
    }
  }, [tokens]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setTokens(null);
    localStorage.removeItem('gmail_tokens');
    setIsAuthenticated(false);
  };

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-indigo-200 rounded-full"></div>
          <div className="h-4 w-24 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen font-sans antialiased">
      {isAuthenticated ? (
        <Dashboard onLogout={handleLogout} tokens={tokens} />
      ) : (
        <Login />
      )}
    </div>
  );
}
