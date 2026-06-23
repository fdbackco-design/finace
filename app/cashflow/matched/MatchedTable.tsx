'use client';

import { useState, useTransition } from 'react';

type MatchedEntry = {
  id:               string;
  company_code:     string;
  entry_date:       string;
  vendor_name:      string;
  vendor_name_override: string | null;
  display_category: string | null;
  category:         string;
  income_amount:    number;
  expense_amount:   number;
  actual_date:      string | null;
  amount_status:    string | null;
  completed_at:     string | null;
  completed_by:     string | null;
  completed_method: string | null;
  match_status:     string;
  invoice_amount:   number;
  actual_amount:    number;
  remaining_amount: number;
};

function fmtKrw(n: number): string {
  if (!n) return '-';
  return new Intl.NumberFormat('ko-KR').format(Math.abs(n));
}

function fmtDate(d: string | null): string {
  return d ? d.slice(0, 10) : '-';
}

const STATUS_STYLE: Record<string, string> = {
  '입금 완료': 'status-done',
  '지급 완료': 'status-done',
  '부분 입금': 'status-partial',
  '입금 예정': 'status-pending',
  '매칭 필요': 'status-error',
};

function RestoreConfirmModal({ count, onConfirm, onClose }: { count: number; onConfirm: () => void; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '28px 32px', width: 360, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>미완료로 복원</h3>
        <p style={{ fontSize: 14, marginBottom: 16 }}>
          선택한 <strong>{count}개</strong> 항목을 미완료 상태로 복원하시겠습니까?
        </p>
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 20 }}>
          기존 그룹, 거래처명 수정, 구분값, 매칭 근거, 이력 정보가 모두 유지됩니다.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 18px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 7, cursor: 'pointer' }}>취소</button>
          <button onClick={onConfirm} style={{ padding: '8px 18px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 600, cursor: 'pointer' }}>복원</button>
        </div>
      </div>
    </div>
  );
}

export default function MatchedTable({ entries: initialEntries }: { entries: MatchedEntry[] }) {
  const [entries,  setEntries]  = useState<MatchedEntry[]>(initialEntries);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [isPending, start]       = useTransition();

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === entries.length) setSelected(new Set());
    else setSelected(new Set(entries.map(e => e.id)));
  }

  function handleRestore() {
    const ids = Array.from(selected);
    start(async () => {
      for (const id of ids) {
        await fetch(`/api/cashflow/${id}/restore`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ restoredBy: 'user' }),
        });
      }
      setEntries(prev => prev.filter(e => !ids.includes(e.id)));
      setSelected(new Set());
      setShowModal(false);
    });
  }

  const hasSelection = selected.size > 0;

  return (
    <>
      {hasSelection && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#7c3aed' }}>{selected.size}개 선택됨</span>
          <button onClick={() => setShowModal(true)} style={{ padding: '5px 12px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 5, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>
            미완료로 복원
          </button>
          <button onClick={() => setSelected(new Set())} style={{ padding: '5px 12px', background: 'transparent', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}>
            선택 해제
          </button>
        </div>
      )}

      <div className="pivot-wrap">
        <table className="pivot-table" style={{ minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === entries.length}
                  onChange={toggleAll}
                  style={{ cursor: 'pointer' }}
                />
              </th>
              <th className="pivot-cat">구분</th>
              <th className="pivot-vendor">거래처</th>
              <th className="num">금액</th>
              <th className="num">납부 날짜</th>
              <th style={{ fontSize: 11, color: '#94a3b8' }}>상태</th>
              <th style={{ fontSize: 11, color: '#94a3b8' }}>완료 일시</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => {
              const vendorName = e.vendor_name_override ?? e.vendor_name;
              const displayCat = e.display_category ?? e.category;
              const amount     = e.income_amount || e.expense_amount;
              const amtCls     = e.income_amount > 0 ? 'amt-income' : 'amt-expense';
              const statusCls  = e.amount_status ? (STATUS_STYLE[e.amount_status] ?? '') : '';
              const isChecked  = selected.has(e.id);

              return (
                <tr key={e.id} style={{ background: isChecked ? '#f5f3ff' : undefined }}>
                  <td>
                    <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(e.id)} style={{ cursor: 'pointer' }} />
                  </td>
                  <td className="pivot-cat" style={{ fontSize: 12 }}>{displayCat}</td>
                  <td className="pivot-vendor" style={{ fontSize: 12 }}>{vendorName}</td>
                  <td className={`num ${amtCls}`} style={{ fontSize: 12 }}>
                    {fmtKrw(amount)}
                  </td>
                  <td className="num" style={{ fontSize: 12 }}>
                    {fmtDate(e.actual_date || e.entry_date)}
                  </td>
                  <td>
                    {e.amount_status && (
                      <span style={{
                        fontSize: 10, padding: '1px 5px', borderRadius: 10, fontWeight: 600,
                        background: statusCls === 'status-done' ? '#d1fae5' : statusCls === 'status-partial' ? '#dbeafe' : '#f1f5f9',
                        color:      statusCls === 'status-done' ? '#065f46' : statusCls === 'status-partial' ? '#1e40af' : '#374151',
                      }}>
                        {e.amount_status}
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: 11, color: '#94a3b8' }}>
                    {e.completed_at ? new Date(e.completed_at).toLocaleDateString('ko-KR') : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showModal && (
        <RestoreConfirmModal
          count={selected.size}
          onConfirm={handleRestore}
          onClose={() => setShowModal(false)}
        />
      )}

      {isPending && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(255,255,255,.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600, color: '#7c3aed' }}>
          처리 중...
        </div>
      )}
    </>
  );
}
