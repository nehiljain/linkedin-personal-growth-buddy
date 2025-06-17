import React, { useState, useEffect } from 'react';

const VERIFY_URL = 'https://roomiy-automations-1b3a1f8f45bc.herokuapp.com/webhook-test/c3027a79-1178-4b7b-8c1b-11c49e38bd81-comment-count?author_profile=https://www.linkedin.com/in/testuser&date=2025-05-20';

function Popup() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stored, setStored] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['auth'], (result) => {
      if (result.auth && result.auth.username && result.auth.password) {
        setStored(true);
      }
    });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(VERIFY_URL, {
        headers: {
          'Authorization': 'Basic ' + btoa(username + ':' + password)
        }
      });
      if (res.ok) {
        chrome.storage.local.set({ auth: { username, password } }, () => {
          setStored(true);
        });
      } else {
        setError('Invalid credentials. Please try again.');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    }
    setLoading(false);
  };

  if (stored) {
    return <div style={{ padding: 20 }}>Credentials saved! You can close this popup.</div>;
  }

  return (
    <form onSubmit={handleSubmit} style={{ padding: 20, minWidth: 250 }}>
      <h2>Enter Backend Credentials</h2>
      <div style={{ marginBottom: 10 }}>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          required
          style={{ width: '100%', padding: 8 }}
        />
      </div>
      <div style={{ marginBottom: 10 }}>
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          style={{ width: '100%', padding: 8 }}
        />
      </div>
      {error && <div style={{ color: 'red', marginBottom: 10 }}>{error}</div>}
      <button type="submit" disabled={loading} style={{ width: '100%', padding: 8 }}>
        {loading ? 'Verifying...' : 'Save Credentials'}
      </button>
    </form>
  );
}

export default Popup; 