'use client';

import { useState } from 'react';

export default function RematchButton({ month }: { month: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<{ deleted: number; created: number; auto: number; manual: number; unmatched: number } | null>(null);
  const [errMsg, setErrMsg] = useState('');

  async function handleClick() {
    if (state === 'loading') return;
    setState('loading');
    setResult(null);
    setErrMsg('');
    try {
      const res = await fetch('/api/cashflow/rematch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      });
      const json = await res.json();
      if (!json.ok) {
        setErrMsg(json.error ?? '알 수 없는 오류');
        setState('error');
        return;
      }
      setResult({
        deleted:   json.deletedCount,
        created:   json.createdCount,
        auto:      json.autoMatched,
        manual:    json.manualReview,
        unmatched: json.unmatched,
      });
      setState('done');
      // 2초 후 페이지 새로고침
      setTimeout(() => window.location.reload(), 2000);
    } catch (e) {
      setErrMsg(String(e));
      setState('error');
    }
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        onClick={handleClick}
        disabled={state === 'loading' || state === 'done'}
        style={{
          padding: '5px 13px',
          fontSize: 12,
          fontWeight: 600,
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          cursor: state === 'loading' || state === 'done' ? 'not-allowed' : 'pointer',
          background: state === 'done' ? '#d1fae5' : state === 'error' ? '#fee2e2' : '#fff',
          color: state === 'done' ? '#065f46' : state === 'error' ? '#991b1b' : '#374151',
          opacity: state === 'loading' ? 0.7 : 1,
          transition: 'all .15s',
        }}
        title={`${month} 데이터 재매칭 실행`}
      >
        {state === 'loading' ? '재매칭 중…' : state === 'done' ? '✓ 완료' : '🔄 재매칭'}
      </button>
      {state === 'done' && result && (
        <span style={{ fontSize: 11, color: '#64748b' }}>
          삭제 {result.deleted} / 생성 {result.created}건 (자동 {result.auto} · 검토 {result.manual} · 미매칭 {result.unmatched})
        </span>
      )}
      {state === 'error' && (
        <span style={{ fontSize: 11, color: '#dc2626' }}>{errMsg}</span>
      )}
    </div>
  );
}
