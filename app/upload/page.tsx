'use client';

/**
 * /upload — 파일 업로드 페이지
 *
 * TODO 보안 (운영 전 필수):
 *  - Supabase Auth 로그인 게이트 추가
 *  - Vercel Deployment Protection 설정
 *  - 업로드 감사 로그 확인
 */

import { useState, useRef, DragEvent, ChangeEvent } from 'react';
import type { UploadApiResponse, FileUploadResult } from '../api/upload/route';

// ── 상수 ─────────────────────────────────────────────────────────────────────
const COMPANIES = [
  { value: '',          label: '자동 감지 (권장)' },
  { value: 'feedback',  label: '피드백' },
  { value: 'sangsaeng', label: '상생' },
  { value: 'shootmoon', label: '슛문' },
];

const SOURCE_TYPE_LABELS: Record<string, string> = {
  BANK_IBK:        '기업은행 계좌',
  BANK_WOORI:      '우리은행 계좌',
  CARD_IBK:        '기업카드',
  CARD_WOORI:      '우리카드',
  HT_PURCHASE_TAX: '홈택스 매입세금계산서',
  HT_PURCHASE:     '홈택스 매입계산서(면세)',
  HT_SALES_TAX:    '홈택스 매출세금계산서',
};

const COMPANY_LABELS: Record<string, string> = {
  feedback: '피드백', sangsaeng: '상생', shootmoon: '슛문',
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── 결과 카드 컴포넌트 ────────────────────────────────────────────────────────
function FileResultCard({ fr }: { fr: FileUploadResult }) {
  const ok = !fr.needsManual && fr.errors.length === 0 && fr.parsedCount > 0;
  const warn = fr.needsManual || (fr.errors.length > 0 && fr.parsedCount > 0);
  const fail = fr.errors.length > 0 && fr.parsedCount === 0;

  const border = ok ? '#bbf7d0' : warn ? '#fde68a' : fail ? '#fca5a5' : '#e2e8f0';
  const bg     = ok ? '#f0fdf4' : warn ? '#fefce8' : fail ? '#fef2f2' : '#f8fafc';

  return (
    <div style={{ border: `1px solid ${border}`, background: bg, borderRadius: 8, padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 4 }}>
        <strong style={{ fontSize: 13, wordBreak: 'break-all' }}>{fr.fileName}</strong>
        <span style={{ fontSize: 11, color: ok ? '#16a34a' : warn ? '#92400e' : '#991b1b', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {ok ? '✓ 성공' : warn ? '⚠ 수동 확인 필요' : '✗ 실패'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#475569', marginTop: 6, lineHeight: 1.8 }}>
        <span>회사: <strong>{fr.companyCode ? COMPANY_LABELS[fr.companyCode] ?? fr.companyCode : '미감지'}</strong></span>
        <span style={{ marginLeft: 16 }}>파일종류: <strong>{fr.sourceType ? SOURCE_TYPE_LABELS[fr.sourceType] ?? fr.sourceType : '미감지'}</strong></span>
        <span style={{ marginLeft: 16 }}>신뢰도: <strong>{(fr.confidence * 100).toFixed(0)}%</strong></span>
        <br />
        <span>파싱: <strong>{fr.parsedCount}건</strong></span>
        {fr.insertedCount > 0 && <span style={{ marginLeft: 12 }}>DB 반영: <strong>{fr.insertedCount}건</strong></span>}
      </div>
      {fr.errors.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#991b1b' }}>
          {fr.errors.slice(0, 3).map((e, i) => <div key={i}>• {e}</div>)}
          {fr.errors.length > 3 && <div>...외 {fr.errors.length - 3}건</div>}
        </div>
      )}
      {fr.reasons.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ fontSize: 11, color: '#64748b', cursor: 'pointer' }}>감지 근거 ({fr.reasons.length})</summary>
          <div style={{ paddingLeft: 12, fontSize: 11, color: '#64748b', marginTop: 2 }}>
            {fr.reasons.map((r, i) => <div key={i}>• {r}</div>)}
          </div>
        </details>
      )}
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function UploadPage() {
  const [month,    setMonth]    = useState(currentMonth());
  const [company,  setCompany]  = useState('');
  const [files,    setFiles]    = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState<UploadApiResponse | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    const valid = Array.from(incoming).filter(f => /\.(xlsx|xls|csv)$/i.test(f.name));
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      const deduped = valid.filter(f => !names.has(f.name));
      return [...prev, ...deduped].slice(0, 20);
    });
  }

  function removeFile(name: string) {
    setFiles(prev => prev.filter(f => f.name !== name));
  }

  async function handleSubmit() {
    if (files.length === 0) return;
    setLoading(true);
    setResult(null);
    setError(null);

    const fd = new FormData();
    fd.append('month',   month);
    fd.append('company', company);
    files.forEach(f => fd.append('files', f));

    try {
      const res  = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json() as UploadApiResponse;
      setResult(data);
      if (!data.ok && data.error) setError(data.error);
    } catch (e) {
      setError(`네트워크 오류: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  const { summary } = result ?? {};

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div>
          <h1 className="page-title">파일 업로드</h1>
          <p className="page-sub">은행거래내역 · 카드명세서 · 홈택스 계산서 → 자동 파싱 → 자금수지현황 반영</p>
        </div>
        <a href="/" style={{ fontSize: 12, color: '#64748b', textDecoration: 'underline' }}>← 홈</a>
      </div>

      {/* ── 경고 배너 ── */}
      <div className="env-warn" style={{ marginBottom: 20, fontSize: 12 }}>
        ⚠️ 이 페이지는 회사 자금 데이터에 접근합니다. 운영 전 반드시 인증 설정을 완료하세요.<br />
        <span style={{ color: '#92400e' }}>TODO: Supabase Auth 로그인 연동 / Vercel Deployment Protection</span>
      </div>

      {/* ── 설정 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>기준월 (참고용)</label>
          <input
            type="month" value={month} onChange={e => setMonth(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>회사 (자동 감지 우선)</label>
          <select
            value={company} onChange={e => setCompany(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, background: '#fff' }}
          >
            {COMPANIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {/* ── 드래그앤드롭 영역 ── */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? '#3b82f6' : '#cbd5e1'}`,
          borderRadius: 10, padding: '32px 20px',
          textAlign: 'center', cursor: 'pointer',
          background: dragging ? '#eff6ff' : '#f8fafc',
          marginBottom: 16, transition: 'all 0.15s',
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>파일을 드래그하거나 클릭하여 선택</div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>.xlsx .xls .csv · 최대 20개 · 파일당 10MB</div>
        <input
          ref={inputRef} type="file" multiple
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={(e: ChangeEvent<HTMLInputElement>) => addFiles(e.target.files)}
        />
      </div>

      {/* ── 선택된 파일 목록 ── */}
      {files.length > 0 && (
        <div style={{ marginBottom: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>선택된 파일 {files.length}개</div>
          {files.map(f => (
            <div key={f.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12 }}>
              <span style={{ wordBreak: 'break-all', flex: 1 }}>{f.name}</span>
              <span style={{ color: '#94a3b8', marginLeft: 8, whiteSpace: 'nowrap' }}>{(f.size / 1024).toFixed(0)}KB</span>
              <button onClick={() => removeFile(f.name)} style={{ marginLeft: 8, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* ── 업로드 버튼 ── */}
      <button
        onClick={handleSubmit}
        disabled={loading || files.length === 0}
        style={{
          display: 'block', width: '100%', padding: '14px',
          background: loading || files.length === 0 ? '#94a3b8' : '#3b82f6',
          color: '#fff', border: 'none', borderRadius: 8,
          fontSize: 15, fontWeight: 700, cursor: loading || files.length === 0 ? 'not-allowed' : 'pointer',
          marginBottom: 24,
        }}
      >
        {loading ? '⏳ 업로드 및 처리 중...' : `🚀 업로드 시작 (${files.length}개)`}
      </button>

      {/* ── 오류 메시지 ── */}
      {error && (
        <div className="env-warn" style={{ background: '#fef2f2', borderColor: '#fca5a5', marginBottom: 20 }}>
          <strong>❌ 오류:</strong> {error}
        </div>
      )}

      {/* ── 결과 ── */}
      {result && (
        <div>
          {/* 요약 카드 */}
          <div style={{ background: result.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${result.ok ? '#bbf7d0' : '#fca5a5'}`, borderRadius: 8, padding: '14px 16px', marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
              {result.ok ? '✅ 업로드 완료' : '⚠️ 일부 처리 실패'}
              {result.uploadSessionId && <span style={{ fontSize: 11, fontWeight: 400, color: '#64748b', marginLeft: 10 }}>세션 ID: {result.uploadSessionId.slice(0, 8)}...</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, fontSize: 12 }}>
              {[
                ['전체 파일', `${result.summary.totalFiles}개`],
                ['성공', `${result.summary.successFiles}개`],
                ['실패', `${result.summary.failedFiles}개`],
                ['은행거래', `${result.summary.bankTransactions}건`],
                ['카드거래', `${result.summary.cardTransactions}건`],
                ['계산서', `${result.summary.hometaxInvoices}건`],
                ['자금수지 생성', `${result.summary.cashflowEntriesCreated}건`],
                ['중복 skip', `${result.summary.cashflowSkipped}건`],
                ['자동매칭', `${result.summary.autoMatched}건`],
                ['수동검토', `${result.summary.manualReview}건`],
                ['미매칭', `${result.summary.unmatched}건`],
              ].map(([label, val]) => (
                <div key={label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px' }}>
                  <div style={{ color: '#64748b', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 이동 버튼 */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <a href={`/cashflow?month=${result.month}`} className="btn" style={{ fontSize: 13, padding: '10px 20px', flex: 1, textAlign: 'center' }}>
              📊 자금수지현황표 보기 ({result.month})
            </a>
            <a href="/unmatched" className="btn btn-outline" style={{ fontSize: 13, padding: '10px 20px', flex: 1, textAlign: 'center' }}>
              🔍 미매칭 검토
            </a>
          </div>

          {/* 파일별 결과 */}
          <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 10 }}>파일별 처리 결과</div>
          {result.files.map((fr, i) => <FileResultCard key={i} fr={fr} />)}
        </div>
      )}
    </div>
  );
}
