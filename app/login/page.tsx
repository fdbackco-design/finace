'use client';

import { useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';

export default function LoginPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const next         = searchParams.get('next') || '/';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.error ?? '로그인에 실패했습니다.');
        return;
      }

      router.replace(next.startsWith('/') ? next : '/');
      router.refresh();
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo-wrap">
          <Image
            src="/feedback-logo.png"
            alt="FEEDBACK"
            width={280}
            height={56}
            priority
            className="login-logo"
          />
        </div>
        <p className="login-subtitle">자금수지현황 관리 시스템</p>

        <form className="login-form" onSubmit={onSubmit}>
          <label className="login-label">
            <span>아이디</span>
            <input
              type="text"
              name="username"
              className="login-input"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
            />
          </label>
          <label className="login-label">
            <span>비밀번호</span>
            <input
              type="password"
              name="password"
              className="login-input"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </label>

          {error && <p className="login-error" role="alert">{error}</p>}

          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? '로그인 중…' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  );
}
