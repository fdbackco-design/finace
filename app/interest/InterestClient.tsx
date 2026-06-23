'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createLoan, updateLoan, deleteLoan, type InterestLoan } from './actions';

const COMPANY_OPTIONS = [
  { code: 'feedback',  label: '피드백' },
  { code: 'sangsaeng', label: '상생'   },
  { code: 'shootmoon', label: '슛문'   },
];

const COMPANY_LABEL: Record<string, string> = {
  feedback:  '피드백',
  sangsaeng: '상생',
  shootmoon: '슛문',
};

function fmtAmt(n: number): string {
  return new Intl.NumberFormat('ko-KR').format(n);
}

// ── 등록/수정 폼 ──────────────────────────────────────────────────────────────

type LoanFormProps = {
  initial?: InterestLoan;
  onDone:   () => void;
  onCancel: () => void;
};

function LoanForm({ initial, onDone, onCancel }: LoanFormProps) {
  const [err, setErr]       = useState('');
  const [isPending, start]  = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr('');
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = initial
        ? await updateLoan(initial.id, fd)
        : await createLoan(fd);
      if (res.error) { setErr(res.error); return; }
      onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="interest-form">
      <h2 className="interest-form-title">
        {initial ? '대출 이자 수정' : '대출 이자 등록'}
      </h2>

      <div className="interest-form-grid">
        {/* 회사명 */}
        <div className="form-row">
          <label className="form-label">회사명 <span className="required">*</span></label>
          <select name="company_code" className="form-input" defaultValue={initial?.company_code ?? ''} required>
            <option value="">선택</option>
            {COMPANY_OPTIONS.map(o => (
              <option key={o.code} value={o.code}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* 대출은행 */}
        <div className="form-row">
          <label className="form-label">대출은행 <span className="required">*</span></label>
          <input
            name="loan_bank"
            type="text"
            className="form-input"
            required
            placeholder="예: 기업은행"
            defaultValue={initial?.loan_bank ?? ''}
          />
        </div>

        {/* 계좌번호 */}
        <div className="form-row">
          <label className="form-label">계좌번호</label>
          <input
            name="account_number"
            type="text"
            className="form-input"
            placeholder="예: 123-456-789012"
            defaultValue={initial?.account_number ?? ''}
          />
        </div>

        {/* 금융기관명 */}
        <div className="form-row">
          <label className="form-label">금융기관명 <span className="required">*</span></label>
          <input
            name="financial_institution"
            type="text"
            className="form-input"
            required
            placeholder="자금수지현황에 표시될 거래처명"
            defaultValue={initial?.financial_institution ?? ''}
          />
        </div>

        {/* 대출기간 */}
        <div className="form-row">
          <label className="form-label">대출 시작일 <span className="required">*</span></label>
          <input
            name="loan_start_date"
            type="date"
            className="form-input"
            required
            defaultValue={initial?.loan_start_date ?? ''}
          />
        </div>
        <div className="form-row">
          <label className="form-label">대출 종료일 <span className="required">*</span></label>
          <input
            name="loan_end_date"
            type="date"
            className="form-input"
            required
            defaultValue={initial?.loan_end_date ?? ''}
          />
        </div>

        {/* 납부일 */}
        <div className="form-row">
          <label className="form-label">납부일 <span className="required">*</span></label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              name="payment_day"
              type="number"
              className="form-input"
              required
              min={1}
              max={31}
              placeholder="25"
              defaultValue={initial?.payment_day ?? ''}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 13, color: '#64748b' }}>일 (매월)</span>
          </div>
        </div>

        {/* 이자 금액 */}
        <div className="form-row">
          <label className="form-label">이자 금액 <span className="required">*</span></label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              name="interest_amount"
              type="number"
              className="form-input"
              required
              min={1}
              placeholder="0"
              defaultValue={initial?.interest_amount ?? ''}
              style={{ width: 160 }}
            />
            <span style={{ fontSize: 13, color: '#64748b' }}>원</span>
          </div>
        </div>

        {/* 메모 */}
        <div className="form-row" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">메모</label>
          <input
            name="memo"
            type="text"
            className="form-input"
            placeholder="(선택)"
            defaultValue={initial?.memo ?? ''}
          />
        </div>
      </div>

      {err && <p className="form-error" style={{ marginTop: 8 }}>{err}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button type="submit" className="btn btn-primary" disabled={isPending}>
          {isPending ? '저장 중…' : '저장'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>취소</button>
      </div>
    </form>
  );
}

// ── 대출 행 ───────────────────────────────────────────────────────────────────

function LoanRow({ loan, onRefresh }: { loan: InterestLoan; onRefresh: () => void }) {
  const [editing,  setEditing]  = useState(false);
  const [err,      setErr]      = useState('');
  const [isPending, start]      = useTransition();
  const router                  = useRouter();

  function handleDelete() {
    const label = `${COMPANY_LABEL[loan.company_code] ?? loan.company_code} / ${loan.financial_institution}`;
    if (!confirm(`"${label}" 대출 이자를 삭제하시겠습니까?\n자금수지현황의 이자 항목도 함께 삭제됩니다.`)) return;
    start(async () => {
      const res = await deleteLoan(loan.id);
      if (res.error) { setErr(res.error); return; }
      router.refresh();
    });
  }

  if (editing) {
    return (
      <div className="interest-loan-row interest-loan-row--editing">
        <LoanForm
          initial={loan}
          onDone={() => { setEditing(false); router.refresh(); onRefresh(); }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="interest-loan-row">
      <div className="interest-loan-cells">
        <span className="interest-cell interest-cell-company">
          {COMPANY_LABEL[loan.company_code] ?? loan.company_code}
        </span>
        <span className="interest-cell interest-cell-bank">{loan.loan_bank}</span>
        <span className="interest-cell interest-cell-account">
          {loan.account_number ?? <span style={{ color: '#94a3b8' }}>-</span>}
        </span>
        <span className="interest-cell interest-cell-institution">{loan.financial_institution}</span>
        <span className="interest-cell interest-cell-period">
          {loan.loan_start_date} ~ {loan.loan_end_date}
        </span>
        <span className="interest-cell interest-cell-day">매월 {loan.payment_day}일</span>
        <span className="interest-cell interest-cell-amount num">
          {fmtAmt(loan.interest_amount)} 원
        </span>
        <span className="interest-cell interest-cell-actions">
          <button className="btn-sm btn-ghost" onClick={() => setEditing(true)}>수정</button>
          <button className="btn-sm btn-danger" onClick={handleDelete} disabled={isPending}>삭제</button>
        </span>
      </div>
      {loan.memo && <div className="interest-loan-memo">{loan.memo}</div>}
      {err && <div className="form-error">{err}</div>}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function InterestClient({ initialLoans }: { initialLoans: InterestLoan[] }) {
  const [showForm, setShowForm] = useState(false);
  const router                  = useRouter();

  const totalByCompany = COMPANY_OPTIONS.map(o => {
    const total = initialLoans
      .filter(l => l.company_code === o.code && l.is_active)
      .reduce((s, l) => s + l.interest_amount, 0);
    return { ...o, total };
  }).filter(o => o.total > 0);

  return (
    <div className="interest-page">
      {/* 헤더 */}
      <div className="interest-header">
        <div>
          <h1 className="page-title">이자 관리</h1>
          <p className="page-sub">등록된 대출 이자는 자금수지현황표에 자동 반영됩니다</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowForm(v => !v)}
        >
          {showForm ? '닫기' : '+ 대출 이자 등록'}
        </button>
      </div>

      {/* 회사별 월 이자 합계 요약 */}
      {totalByCompany.length > 0 && (
        <div className="interest-summary">
          {totalByCompany.map(o => (
            <div key={o.code} className="interest-summary-card">
              <div className="interest-summary-label">{o.label} 월 이자</div>
              <div className="interest-summary-value">{fmtAmt(o.total)}원</div>
            </div>
          ))}
        </div>
      )}

      {/* 등록 폼 */}
      {showForm && (
        <LoanForm
          onDone={() => { setShowForm(false); router.refresh(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* 목록 헤더 */}
      {initialLoans.length > 0 && (
        <div className="interest-list-header">
          <span className="interest-cell interest-cell-company">회사</span>
          <span className="interest-cell interest-cell-bank">대출은행</span>
          <span className="interest-cell interest-cell-account">계좌번호</span>
          <span className="interest-cell interest-cell-institution">금융기관명</span>
          <span className="interest-cell interest-cell-period">대출기간</span>
          <span className="interest-cell interest-cell-day">납부일</span>
          <span className="interest-cell interest-cell-amount num">이자금액</span>
          <span className="interest-cell interest-cell-actions">관리</span>
        </div>
      )}

      {/* 목록 */}
      {initialLoans.length === 0 ? (
        <div className="interest-empty">
          등록된 대출 이자가 없습니다. 위 버튼으로 추가해주세요.
        </div>
      ) : (
        <div className="interest-list">
          {initialLoans.map(loan => (
            <LoanRow key={loan.id} loan={loan} onRefresh={() => router.refresh()} />
          ))}
        </div>
      )}
    </div>
  );
}
