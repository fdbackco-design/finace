'use client';

import { useState } from 'react';
import type { CashflowMonthlyRow } from '@/src/lib/cashflow/monthlyPivot';

// ── 카드 상세용 타입 ──────────────────────────────────────────────────────────

export type PivotCardTx = {
  id:          string;
  usedDate:    string;
  vendorName:  string;
  amount:      number;
  isHtMatched: boolean;
};

export type PivotCardGroup = {
  cardKey:     string;
  label:       string;
  period: {
    settlementDate: string;
    usedDateFrom:   string;
    usedDateTo:     string;
  };
  transactions: PivotCardTx[];
};

// ── 포맷 헬퍼 ─────────────────────────────────────────────────────────────────

function fmtAmt(v: number): { text: string; cls: string } {
  if (v === 0) return { text: '', cls: '' };
  const abs = new Intl.NumberFormat('ko-KR').format(Math.abs(v));
  return v > 0
    ? { text: abs, cls: 'amt-income' }
    : { text: abs, cls: 'amt-expense' };
}

function fmtKrw(n: number): string {
  return new Intl.NumberFormat('ko-KR').format(Math.abs(n));
}

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────

export default function PivotTable({
  rows,
  cardGroups,
  daysInMonth,
  year,
  month,
}: {
  rows:        CashflowMonthlyRow[];
  cardGroups:  PivotCardGroup[];
  daysInMonth: number;
  year:        number;
  month:       number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const dayNums  = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const weekdays = dayNums.map(d => new Date(year, month - 1, d).getDay());

  function toggle(cardKey: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(cardKey)) next.delete(cardKey);
      else next.add(cardKey);
      return next;
    });
  }

  // check 그룹별로 묶기
  const groups: [string, CashflowMonthlyRow[]][] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (!last || last[0] !== row.check) groups.push([row.check, [row]]);
    else last[1].push(row);
  }

  // cardKey → PivotCardGroup 맵
  const cardGroupMap = new Map<string, PivotCardGroup>(
    cardGroups.map(g => [g.cardKey, g])
  );

  return (
    <div className="pivot-wrap">
      <table className="pivot-table">
        <thead>
          <tr>
            <th className="pivot-check sticky-col-1">체크</th>
            <th className="pivot-cat  sticky-col-2">구분</th>
            <th className="pivot-vendor sticky-col-3">거래처</th>
            <th className="pivot-total  sticky-col-4 num">지출금액</th>
            {dayNums.map(d => (
              <th
                key={d}
                className={`pivot-day num${weekdays[d - 1] === 0 ? ' pivot-day-sun' : weekdays[d - 1] === 6 ? ' pivot-day-sat' : ''}`}
              >
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(([check, groupRows]) => (
            <>
              {/* 그룹 헤더 행 */}
              <tr key={`gh-${check}`} className="pivot-group-header">
                <td colSpan={4 + daysInMonth}>{check}</td>
              </tr>

              {groupRows.map((row, ri) => {
                const totFmt  = fmtAmt(row.total);
                const isCard  = !!row.cardKey;
                const isOpen  = isCard && expanded.has(row.cardKey!);
                const group   = isCard ? cardGroupMap.get(row.cardKey!) : undefined;

                return (
                  <>
                    {/* 메인 행 */}
                    <tr
                      key={`${check}-${ri}`}
                      className={`${row.total > 0 ? 'pivot-row-income' : 'pivot-row-expense'}${isCard ? ' pivot-row-card' : ''}`}
                    >
                      {/* 체크 + 카드 토글 버튼 */}
                      <td className="sticky-col-1 pivot-check">
                        {isCard ? (
                          <button
                            className="pivot-card-toggle"
                            onClick={() => toggle(row.cardKey!)}
                            title={isOpen ? '접기' : '펼치기'}
                          >
                            {isOpen ? '▾' : '▸'}
                          </button>
                        ) : (
                          row.check
                        )}
                      </td>
                      <td className="sticky-col-2 pivot-cat">{row.category}</td>
                      <td className="sticky-col-3 pivot-vendor">
                        {isCard && group ? (
                          <span>
                            {group.label}
                            <span className="pivot-card-period">
                              &nbsp;·&nbsp;결제 {group.period.settlementDate.slice(5)}&nbsp;&nbsp;
                              사용 {group.period.usedDateFrom.slice(5)} ~ {group.period.usedDateTo.slice(5)}
                            </span>
                          </span>
                        ) : (
                          row.vendorName
                        )}
                      </td>
                      <td className={`sticky-col-4 pivot-total num ${totFmt.cls}`}>{totFmt.text}</td>
                      {dayNums.map(d => {
                        const v = row.days[d];
                        if (!v) return <td key={d} className="pivot-day" />;
                        const { text, cls } = fmtAmt(v);
                        return <td key={d} className={`pivot-day num ${cls}`}>{text}</td>;
                      })}
                    </tr>

                    {/* 카드 상세 sub-rows (펼쳤을 때) */}
                    {isCard && isOpen && group && (
                      group.transactions.length === 0 ? (
                        <tr key={`${row.cardKey}-empty`} className="pivot-card-detail-empty">
                          <td colSpan={4 + daysInMonth}>
                            해당 기간 카드 거래 내역이 없습니다.
                          </td>
                        </tr>
                      ) : (
                        group.transactions.map(tx => (
                          <tr key={tx.id} className={`pivot-card-detail-row${tx.isHtMatched ? ' pivot-card-detail-ht' : ''}`}>
                            <td className="sticky-col-1 pivot-card-detail-indent" />
                            <td className="sticky-col-2 pivot-card-detail-date">{tx.usedDate}</td>
                            <td className="sticky-col-3 pivot-card-detail-vendor">
                              {tx.vendorName}
                              {tx.isHtMatched && (
                                <span className="pivot-card-detail-tag">계산서</span>
                              )}
                            </td>
                            <td className="sticky-col-4 pivot-card-detail-amt num amt-expense">
                              {fmtKrw(tx.amount)}
                            </td>
                            {dayNums.map(d => (
                              <td key={d} className="pivot-day pivot-card-detail-day" />
                            ))}
                          </tr>
                        ))
                      )
                    )}
                  </>
                );
              })}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
