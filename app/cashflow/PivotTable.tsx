'use client';

import { useState, Fragment, useCallback, useTransition, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
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

// ── 금액 상태 뱃지 색상 ───────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  '입금 예정':          'status-pending',
  '실제 입금':          'status-done',
  '입금 완료':          'status-done',
  '부분 입금':          'status-partial',
  '지급 예정':          'status-pending',
  '실제 지급':          'status-done',
  '지급 완료':          'status-done',
  '부분 지급':          'status-partial',
  '미수 잔액':          'status-warning',
  '미지급 잔액':        'status-warning',
  '초과 입금 검토 필요': 'status-error',
  '초과 지급 검토 필요': 'status-error',
  '매칭 필요':          'status-error',
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

// ── 거래처 편집 모달 ─────────────────────────────────────────────────────────

function VendorEditModal({
  entryIds,
  currentName,
  onConfirm,
  onClose,
}: {
  entryIds:    string[];
  currentName: string;
  onConfirm:   (newName: string) => void;
  onClose:     () => void;
}) {
  const [value, setValue] = useState(currentName);
  const [step,  setStep]  = useState<'edit' | 'confirm'>('edit');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        {step === 'edit' ? (
          <>
            <h3 className="modal-title">거래처명 수정</h3>
            <p className="modal-sub">수정 후 저장하면 이력이 기록됩니다.</p>
            <input
              className="modal-input"
              value={value}
              onChange={e => setValue(e.target.value)}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') setStep('confirm'); if (e.key === 'Escape') onClose(); }}
            />
            <div className="modal-actions">
              <button className="btn-secondary" onClick={onClose}>취소</button>
              <button className="btn-primary" onClick={() => setStep('confirm')} disabled={!value.trim() || value.trim() === currentName}>
                저장
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="modal-title">수정 확인</h3>
            <p className="modal-confirm-text">
              <strong>{value.trim()}</strong>으로 정말 수정하시겠습니까?
            </p>
            <p className="modal-sub">{entryIds.length}개 항목에 적용됩니다.</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setStep('edit')}>뒤로</button>
              <button className="btn-primary" onClick={() => onConfirm(value.trim())}>확인</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── 그룹 생성 모달 ───────────────────────────────────────────────────────────

function GroupCreateModal({
  selectedCount,
  onConfirm,
  onClose,
}: {
  selectedCount: number;
  onConfirm: (groupName: string) => void;
  onClose:   () => void;
}) {
  const [name, setName] = useState('');
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">그룹 만들기</h3>
        <p className="modal-sub">{selectedCount}개 항목을 하나의 그룹으로 묶습니다.</p>
        <input
          className="modal-input"
          placeholder="그룹명 입력"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onConfirm(name.trim()); if (e.key === 'Escape') onClose(); }}
        />
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>취소</button>
          <button className="btn-primary" onClick={() => onConfirm(name.trim())} disabled={!name.trim()}>
            그룹 생성
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 그룹에 추가 모달 ─────────────────────────────────────────────────────────

function GroupAddModal({
  selectedCount,
  groups,
  onConfirm,
  onClose,
}: {
  selectedCount: number;
  groups: { id: string; name: string; memberCount: number }[];
  onConfirm: (groupId: string, groupName: string) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string>('');
  const pickedName = groups.find(g => g.id === picked)?.name ?? '';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">그룹에 추가</h3>
        <p className="modal-sub">{selectedCount}개 항목을 추가할 그룹을 선택하세요.</p>
        <div className="group-add-list">
          {groups.map(g => (
            <div
              key={g.id}
              className={`group-add-item${picked === g.id ? ' group-add-item-active' : ''}`}
              onClick={() => setPicked(g.id)}
            >
              <span className="group-add-name">{g.name}</span>
              <span className="group-add-count">{g.memberCount}건</span>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>취소</button>
          <button
            className="btn-primary"
            disabled={!picked}
            onClick={() => onConfirm(picked, pickedName)}
          >
            추가
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 매칭 완료 확인 모달 ──────────────────────────────────────────────────────

function CompleteConfirmModal({
  selectedCount,
  onConfirm,
  onClose,
}: {
  selectedCount: number;
  onConfirm: () => void;
  onClose:   () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">매칭 완료 처리</h3>
        <p className="modal-confirm-text">
          선택한 <strong>{selectedCount}개</strong> 항목을 매칭 완료 처리하시겠습니까?
        </p>
        <p className="modal-sub">완료된 항목은 이 목록에서 숨겨지고 <strong>매칭 완료 내역</strong> 페이지로 이동합니다.</p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>취소</button>
          <button className="btn-primary btn-danger" onClick={onConfirm}>확인</button>
        </div>
      </div>
    </div>
  );
}

// ── 구분 드롭다운 ─────────────────────────────────────────────────────────────
// position: fixed + getBoundingClientRect() 로 테이블 셀 밖으로 오버플로우

type DropdownPos = { top: number; left: number; width: number };

function CategoryDropdown({
  entryIds,
  current,
  items,
  onSave,
}: {
  entryIds: string[];
  current:  string;
  items:    string[];
  onSave:   (val: string) => void;
}) {
  const [open,     setOpen]     = useState(false);
  const [pos,      setPos]      = useState<DropdownPos | null>(null);
  const [addMode,  setAddMode]  = useState(false);
  const [newItem,  setNewItem]  = useState('');
  const [isPending, start]      = useTransition();
  const btnRef  = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 드롭다운 바깥 스크롤·리사이즈 시 닫기 (메뉴 내부 스크롤은 제외)
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function openDropdown() {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({
      top:   rect.bottom + 2,
      left:  rect.left,
      width: Math.max(rect.width, 160),
    });
    setOpen(true);
  }

  const handleSelect = (val: string) => {
    setOpen(false);
    if (val !== current) onSave(val);
  };

  const handleAddItem = () => {
    if (!newItem.trim()) return;
    start(async () => {
      await fetch('/api/cashflow/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_value: newItem.trim() }),
      });
      onSave(newItem.trim());
      setNewItem('');
      setAddMode(false);
      setOpen(false);
    });
  };

  return (
    <>
      <button
        ref={btnRef}
        className="cat-display-btn"
        onClick={openDropdown}
        title="구분 변경"
      >
        {current || <span style={{ color: '#94a3b8' }}>미분류</span>}
        <span className="cat-caret">▾</span>
      </button>

      {/* createPortal로 document.body에 직접 렌더 — 테이블 stacking context 완전 탈출 */}
      {open && pos && typeof document !== 'undefined' && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
            onMouseDown={() => setOpen(false)}
          />
          <div
            ref={menuRef}
            className="cat-dropdown-menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, zIndex: 10000 }}
            onMouseDown={e => e.preventDefault()}
          >
            {items.map(item => (
              <div
                key={item}
                className={`cat-dropdown-item${item === current ? ' cat-dropdown-item-active' : ''}`}
                onClick={() => handleSelect(item)}
              >
                {item}
              </div>
            ))}
            <div className="cat-dropdown-divider" />
            {addMode ? (
              <div className="cat-dropdown-add">
                <input
                  className="cat-add-input"
                  value={newItem}
                  onChange={e => setNewItem(e.target.value)}
                  placeholder="새 항목 입력"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') handleAddItem(); if (e.key === 'Escape') setAddMode(false); }}
                />
                <button className="btn-tiny" onClick={handleAddItem} disabled={isPending}>추가</button>
                <button className="btn-tiny-ghost" onClick={() => setAddMode(false)}>취소</button>
              </div>
            ) : (
              <div className="cat-dropdown-item cat-dropdown-add-btn" onClick={() => setAddMode(true)}>
                + 항목 추가
              </div>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function PivotTable({
  rows,
  cardGroups,
  categoryItems,
  daysInMonth,
  year,
  month,
}: {
  rows:          CashflowMonthlyRow[];
  cardGroups:    PivotCardGroup[];
  categoryItems: string[];
  daysInMonth:   number;
  year:          number;
  month:         number;
}) {
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set());
  const [selected,    setSelected]    = useState<Set<string>>(new Set()); // rowKey set
  const [localRows,   setLocalRows]   = useState<CashflowMonthlyRow[]>(rows);
  const [collapsedGrp, setCollapsedGrp] = useState<Set<string>>(new Set()); // groupId set

  // 모달 상태
  const [vendorModal,   setVendorModal]   = useState<{ rowKey: string; entryIds: string[]; currentName: string } | null>(null);
  const [groupModal,    setGroupModal]    = useState(false);
  const [groupAddModal, setGroupAddModal] = useState(false);
  const [completeModal, setCompleteModal] = useState(false);
  const [isPending, startTransition]      = useTransition();

  // 그룹명 인라인 편집 상태
  const [editingGroupId,   setEditingGroupId]   = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');

  // ── 드래그 스크롤 ────────────────────────────────────────────────────────
  const wrapRef  = useRef<HTMLDivElement>(null);
  const dragRef  = useRef<{ active: boolean; startX: number; scrollLeft: number }>({
    active: false, startX: 0, scrollLeft: 0,
  });

  const onDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // 인터랙티브 요소 위에서는 드래그 비활성화
    const tag = (e.target as HTMLElement).tagName;
    if (['BUTTON', 'INPUT', 'A', 'SELECT', 'TEXTAREA'].includes(tag)) return;
    if (!wrapRef.current) return;
    dragRef.current = { active: true, startX: e.pageX, scrollLeft: wrapRef.current.scrollLeft };
    wrapRef.current.style.cursor = 'grabbing';
    wrapRef.current.style.userSelect = 'none';
  }, []);

  const onDragMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || !wrapRef.current) return;
    const dx = e.pageX - dragRef.current.startX;
    wrapRef.current.scrollLeft = dragRef.current.scrollLeft - dx;
  }, []);

  const onDragEnd = useCallback(() => {
    dragRef.current.active = false;
    if (!wrapRef.current) return;
    wrapRef.current.style.cursor = '';
    wrapRef.current.style.userSelect = '';
  }, []);

  const dayNums  = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const weekdays = dayNums.map(d => new Date(year, month - 1, d).getDay());

  // ── 체크박스 핸들러 ────────────────────────────────────────────────────────

  function rowKey(row: CashflowMonthlyRow): string {
    return `${row.check}::${row.category}::${row.vendorName}`;
  }

  function toggleSelect(key: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    const allKeys = localRows.map(rowKey);
    if (selected.size === allKeys.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allKeys));
    }
  }

  // ── 카드 펼치기 ───────────────────────────────────────────────────────────

  function toggleCard(cardKey: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(cardKey)) next.delete(cardKey); else next.add(cardKey);
      return next;
    });
  }

  // ── 그룹 접기/펼치기 ─────────────────────────────────────────────────────

  function toggleGroup(groupId: string) {
    setCollapsedGrp(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }

  // ── 거래처명 저장 ─────────────────────────────────────────────────────────

  const handleVendorSave = useCallback((entryIds: string[], newName: string) => {
    startTransition(async () => {
      for (const id of entryIds) {
        await fetch(`/api/cashflow/${id}/vendor`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vendor_name: newName }),
        });
      }
      setLocalRows(prev =>
        prev.map(r =>
          r.rawEntryIds.some(id => entryIds.includes(id))
            ? { ...r, vendorName: newName }
            : r
        )
      );
      setVendorModal(null);
    });
  }, []);

  // ── 구분 저장 ─────────────────────────────────────────────────────────────

  const handleCategorySave = useCallback((entryIds: string[], newCat: string) => {
    startTransition(async () => {
      for (const id of entryIds) {
        await fetch(`/api/cashflow/${id}/category`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_category: newCat }),
        });
      }
      setLocalRows(prev =>
        prev.map(r =>
          r.rawEntryIds.some(id => entryIds.includes(id))
            ? { ...r, displayCategory: newCat }
            : r
        )
      );
    });
  }, []);

  // ── 그룹 생성 ────────────────────────────────────────────────────────────

  const handleGroupCreate = useCallback((groupName: string) => {
    const selectedRows = localRows.filter(r => selected.has(rowKey(r)));
    const entryIds     = selectedRows.flatMap(r => r.rawEntryIds);
    const companyCode  = selectedRows[0]?.check ?? '';

    startTransition(async () => {
      const res = await fetch('/api/cashflow/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_name:   groupName,
          entry_ids:    entryIds,
          company_code: companyCode,
          month:        `${year}-${String(month).padStart(2, '0')}`,
        }),
      });
      const json = await res.json();
      if (json.group) {
        setLocalRows(prev =>
          prev.map(r =>
            selected.has(rowKey(r))
              ? { ...r, groupId: json.group.id, groupName }
              : r
          )
        );
      }
      setGroupModal(false);
      setSelected(new Set());
    });
  }, [localRows, selected, year, month]);

  // ── 그룹에 항목 추가 ─────────────────────────────────────────────────────

  const handleGroupAdd = useCallback((groupId: string, groupName: string) => {
    const entryIds = localRows
      .filter(r => selected.has(rowKey(r)))
      .flatMap(r => r.rawEntryIds);

    startTransition(async () => {
      await fetch('/api/cashflow/groups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: groupId, entry_ids: entryIds }),
      });
      setLocalRows(prev =>
        prev.map(r =>
          selected.has(rowKey(r))
            ? { ...r, groupId, groupName }
            : r
        )
      );
      setGroupAddModal(false);
      setSelected(new Set());
    });
  }, [localRows, selected]);

  // ── 그룹명 수정 ──────────────────────────────────────────────────────────

  const handleGroupRename = useCallback((groupId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) { setEditingGroupId(null); return; }
    startTransition(async () => {
      await fetch('/api/cashflow/groups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: groupId, group_name: trimmed }),
      });
      setLocalRows(prev =>
        prev.map(r => r.groupId === groupId ? { ...r, groupName: trimmed } : r)
      );
      setEditingGroupId(null);
    });
  }, []);

  // ── 매칭 완료 처리 ───────────────────────────────────────────────────────

  const handleComplete = useCallback(() => {
    const entryIds = localRows
      .filter(r => selected.has(rowKey(r)))
      .flatMap(r => r.rawEntryIds);

    startTransition(async () => {
      await fetch('/api/cashflow/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryIds }),
      });
      setLocalRows(prev => prev.filter(r => !selected.has(rowKey(r))));
      setSelected(new Set());
      setCompleteModal(false);
    });
  }, [localRows, selected]);

  // ── 그룹 메타 계산 (그룹 헤더 표시용) ───────────────────────────────────

  type GroupMeta = { name: string; total: number; memberCount: number };
  const groupMeta = new Map<string, GroupMeta>();
  for (const row of localRows) {
    if (!row.groupId) continue;
    if (!groupMeta.has(row.groupId)) {
      groupMeta.set(row.groupId, { name: row.groupName ?? '그룹', total: 0, memberCount: 0 });
    }
    const gm = groupMeta.get(row.groupId)!;
    gm.total      += row.total;
    gm.memberCount++;
  }

  const existingGroups = Array.from(groupMeta.entries()).map(([id, gm]) => ({
    id,
    name: gm.name,
    memberCount: gm.memberCount,
  }));

  // check 그룹별 묶기 (기존 로직)
  function groupByCheck(rowList: CashflowMonthlyRow[]): [string, CashflowMonthlyRow[]][] {
    const groups: [string, CashflowMonthlyRow[]][] = [];
    for (const row of rowList) {
      const last = groups[groups.length - 1];
      if (!last || last[0] !== row.check) groups.push([row.check, [row]]);
      else last[1].push(row);
    }
    return groups;
  }

  const cardGroupMap = new Map<string, PivotCardGroup>(
    cardGroups.map(g => [g.cardKey, g])
  );

  const selectedCount = selected.size;
  const hasSelection  = selectedCount > 0;

  // ── 행 렌더링 헬퍼 ──────────────────────────────────────────────────────

  function renderRow(row: CashflowMonthlyRow, ri: number, checkLabel: string) {
    const key      = rowKey(row);
    const isCardRow = !!row.cardKey;
    const isOpen    = isCardRow && expanded.has(row.cardKey!);
    const group     = isCardRow ? cardGroupMap.get(row.cardKey!) : undefined;
    const totFmt    = fmtAmt(row.total);
    const isChecked = selected.has(key);
    const statusCls = row.amountStatus ? (STATUS_STYLE[row.amountStatus] ?? '') : '';

    return (
      <Fragment key={`row-${checkLabel}-${ri}`}>
        <tr className={`${row.total > 0 ? 'pivot-row-income' : 'pivot-row-expense'}${isCardRow ? ' pivot-row-card' : ''}${isChecked ? ' pivot-row-selected' : ''}`}>
          {/* 체크박스 */}
          <td className="sticky-col-1 pivot-check">
            <input
              type="checkbox"
              className="row-checkbox"
              checked={isChecked}
              onChange={() => toggleSelect(key)}
            />
            {isCardRow && (
              <button
                className="pivot-card-toggle"
                onClick={() => toggleCard(row.cardKey!)}
                title={isOpen ? '접기' : '펼치기'}
              >
                {isOpen ? '▾' : '▸'}
              </button>
            )}
          </td>

          {/* 구분 드롭다운 */}
          <td className="sticky-col-2 pivot-cat">
            <CategoryDropdown
              entryIds={row.rawEntryIds}
              current={row.displayCategory || row.category}
              items={categoryItems}
              onSave={(val) => handleCategorySave(row.rawEntryIds, val)}
            />
          </td>

          {/* 거래처 (더블클릭 편집) */}
          <td
            className="sticky-col-3 pivot-vendor"
            onDoubleClick={() => setVendorModal({ rowKey: key, entryIds: row.rawEntryIds, currentName: row.vendorName })}
            title="더블 클릭하여 거래처명 수정"
          >
            {isCardRow && group ? (
              <>
                {group.label}
                <span className="pivot-card-period">
                  &nbsp;·&nbsp;결제 {group.period.settlementDate.slice(5)}
                  &nbsp;&nbsp;사용 {group.period.usedDateFrom.slice(5)} ~ {group.period.usedDateTo.slice(5)}
                </span>
              </>
            ) : (
              <span className="vendor-editable">{row.vendorName}</span>
            )}
          </td>

          {/* 금액 (구 "지출금액") */}
          <td className={`sticky-col-4 pivot-total num ${totFmt.cls}`}>
            <div className="amt-cell">
              <span>{totFmt.text}</span>
              {row.amountStatus && (
                <span className={`status-badge ${statusCls}`}>{row.amountStatus}</span>
              )}
              {row.remainingAmount > 0 && row.amountStatus && ['부분 입금','미수 잔액'].includes(row.amountStatus) && (
                <span className="amt-remaining">잔 {fmtKrw(row.remainingAmount)}</span>
              )}
            </div>
          </td>

          {/* 일별 셀 */}
          {dayNums.map(d => {
            const v = row.days[d];
            if (!v) return <td key={d} className="pivot-day" />;
            const { text, cls } = fmtAmt(v);
            return <td key={d} className={`pivot-day num ${cls}`}>{text}</td>;
          })}
        </tr>

        {/* 카드 상세 sub-rows */}
        {isCardRow && isOpen && (
          !group || group.transactions.length === 0 ? (
            <tr className="pivot-card-detail-empty">
              <td colSpan={4 + daysInMonth}>해당 기간 카드 거래 내역이 없습니다.</td>
            </tr>
          ) : (
            group.transactions.map(tx => (
              <tr key={tx.id} className={`pivot-card-detail-row${tx.isHtMatched ? ' pivot-card-detail-ht' : ''}`}>
                <td className="sticky-col-1 pivot-card-detail-indent" />
                <td className="sticky-col-2 pivot-card-detail-date">{tx.usedDate}</td>
                <td className="sticky-col-3 pivot-card-detail-vendor">
                  {tx.vendorName}
                  {tx.isHtMatched && <span className="pivot-card-detail-tag">계산서</span>}
                </td>
                <td className="sticky-col-4 pivot-card-detail-amt num amt-expense">
                  {fmtKrw(tx.amount)}
                </td>
                {dayNums.map(d => <td key={d} className="pivot-day pivot-card-detail-day" />)}
              </tr>
            ))
          )
        )}
      </Fragment>
    );
  }

  // ── 렌더 ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* 배치 액션 툴바 */}
      {hasSelection && (
        <div className="batch-toolbar">
          <span className="batch-count">{selectedCount}개 선택됨</span>
          <button className="btn-batch" onClick={() => setGroupModal(true)}>
            그룹 만들기
          </button>
          {existingGroups.length > 0 && (
            <button className="btn-batch btn-batch-add" onClick={() => setGroupAddModal(true)}>
              그룹에 추가
            </button>
          )}
          <button className="btn-batch btn-batch-complete" onClick={() => setCompleteModal(true)}>
            매칭 완료 처리
          </button>
          <button className="btn-batch-ghost" onClick={() => setSelected(new Set())}>
            선택 해제
          </button>
        </div>
      )}

      <div
        ref={wrapRef}
        className="pivot-wrap"
        onMouseDown={onDragStart}
        onMouseMove={onDragMove}
        onMouseUp={onDragEnd}
        onMouseLeave={onDragEnd}
        style={{ cursor: 'grab' }}
      >
        <table className="pivot-table">
          <thead>
            <tr>
              <th className="pivot-check sticky-col-1">
                <input
                  type="checkbox"
                  className="row-checkbox"
                  checked={selected.size > 0 && selected.size === localRows.length}
                  onChange={toggleSelectAll}
                  title="전체 선택/해제"
                />
              </th>
              <th className="pivot-cat  sticky-col-2">구분</th>
              <th className="pivot-vendor sticky-col-3">거래처</th>
              <th className="pivot-total  sticky-col-4 num">금액</th>
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
            {(() => {
              const seenGroupIds = new Set<string>();
              return groupByCheck(localRows).map(([check, sectionRows]) => (
                <Fragment key={`section-${check}`}>
                  <tr className="pivot-group-header">
                    <td colSpan={4 + daysInMonth}>{check}</td>
                  </tr>
                  {sectionRows.map((row, ri) => {
                    if (!row.groupId) {
                      return renderRow(row, ri, check);
                    }
                    const isFirstInGroup = !seenGroupIds.has(row.groupId);
                    if (isFirstInGroup) seenGroupIds.add(row.groupId);
                    const isCollapsed = collapsedGrp.has(row.groupId);
                    const gm = groupMeta.get(row.groupId);
                    if (!gm) return null;
                    const totFmt = fmtAmt(gm.total);

                    return (
                      <Fragment key={`grp-member-${row.groupId}-${ri}`}>
                        {isFirstInGroup && (
                          <tr className="pivot-group-row">
                            <td className="sticky-col-1">
                              <button
                                className="group-toggle-btn"
                                onClick={() => toggleGroup(row.groupId!)}
                                title={isCollapsed ? '펼치기' : '접기'}
                              >
                                {isCollapsed ? '▸' : '▾'}
                              </button>
                            </td>
                            <td colSpan={2} className="group-name-cell">
                              {editingGroupId === row.groupId ? (
                                <input
                                  className="group-name-input"
                                  value={editingGroupName}
                                  autoFocus
                                  onChange={e => setEditingGroupName(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter')  handleGroupRename(row.groupId!, editingGroupName);
                                    if (e.key === 'Escape') setEditingGroupId(null);
                                  }}
                                  onBlur={() => handleGroupRename(row.groupId!, editingGroupName)}
                                  onClick={e => e.stopPropagation()}
                                />
                              ) : (
                                <>
                                  <span
                                    className="group-name-text"
                                    onDoubleClick={() => {
                                      setEditingGroupId(row.groupId!);
                                      setEditingGroupName(gm.name);
                                    }}
                                    title="더블 클릭하여 그룹명 수정"
                                  >
                                    {gm.name}
                                  </span>
                                  <span className="group-meta">&nbsp;·&nbsp;{gm.memberCount}건</span>
                                </>
                              )}
                            </td>
                            <td className={`sticky-col-4 num ${totFmt.cls}`}>{totFmt.text}</td>
                            <td colSpan={daysInMonth} />
                          </tr>
                        )}
                        {!isCollapsed && renderRow(row, ri, check)}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ));
            })()}
          </tbody>
        </table>
      </div>

      {/* 거래처 편집 모달 */}
      {vendorModal && (
        <VendorEditModal
          entryIds={vendorModal.entryIds}
          currentName={vendorModal.currentName}
          onConfirm={(newName) => handleVendorSave(vendorModal.entryIds, newName)}
          onClose={() => setVendorModal(null)}
        />
      )}

      {/* 그룹 생성 모달 */}
      {groupModal && (
        <GroupCreateModal
          selectedCount={selectedCount}
          onConfirm={handleGroupCreate}
          onClose={() => setGroupModal(false)}
        />
      )}

      {/* 그룹에 추가 모달 */}
      {groupAddModal && (
        <GroupAddModal
          selectedCount={selectedCount}
          groups={existingGroups}
          onConfirm={handleGroupAdd}
          onClose={() => setGroupAddModal(false)}
        />
      )}

      {/* 매칭 완료 확인 모달 */}
      {completeModal && (
        <CompleteConfirmModal
          selectedCount={selectedCount}
          onConfirm={handleComplete}
          onClose={() => setCompleteModal(false)}
        />
      )}

      {isPending && <div className="loading-overlay">처리 중...</div>}

      {/* 인라인 스타일 */}
      <style>{`
        .row-checkbox { width: 15px; height: 15px; cursor: pointer; accent-color: #7c3aed; }
        .pivot-row-selected td { background: #f5f3ff !important; }
        .batch-toolbar {
          display: flex; align-items: center; gap: 8px; padding: 8px 12px;
          background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 8px; margin-bottom: 8px; flex-wrap: wrap;
        }
        .batch-count { font-size: 13px; font-weight: 600; color: #7c3aed; margin-right: 4px; }
        .btn-batch { padding: 5px 12px; background: #7c3aed; color: #fff; border: none; border-radius: 5px; font-size: 12px; cursor: pointer; font-weight: 500; }
        .btn-batch:hover { background: #6d28d9; }
        .btn-batch-complete { background: #059669; }
        .btn-batch-complete:hover { background: #047857; }
        .btn-batch-add { background: #0ea5e9; }
        .btn-batch-add:hover { background: #0284c7; }
        .btn-batch-ghost { padding: 5px 12px; background: transparent; color: #64748b; border: 1px solid #e2e8f0; border-radius: 5px; font-size: 12px; cursor: pointer; }
        .amt-cell { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
        .status-badge { font-size: 10px; padding: 1px 5px; border-radius: 10px; font-weight: 600; white-space: nowrap; }
        .status-pending { background: #fef3c7; color: #92400e; }
        .status-done    { background: #d1fae5; color: #065f46; }
        .status-partial { background: #dbeafe; color: #1e40af; }
        .status-warning { background: #fed7aa; color: #9a3412; }
        .status-error   { background: #fee2e2; color: #991b1b; }
        .amt-remaining { font-size: 10px; color: #ef4444; }
        .vendor-editable { cursor: pointer; }
        .vendor-editable:hover { text-decoration: underline; color: #7c3aed; }
        /* 구분 드롭다운 — position:fixed 로 테이블 셀 밖 렌더 */
        .cat-display-btn { background: none; border: none; padding: 2px 6px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 3px; border-radius: 4px; width: 100%; text-align: left; white-space: nowrap; overflow: hidden; }
        .cat-display-btn:hover { background: #f1f5f9; }
        .cat-caret { font-size: 10px; color: #94a3b8; flex-shrink: 0; }
        .cat-dropdown-menu { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.15); min-width: 160px; max-height: 280px; overflow-y: auto; }
        .cat-dropdown-item { padding: 7px 13px; font-size: 13px; cursor: pointer; white-space: nowrap; }
        .cat-dropdown-item:hover { background: #f8fafc; }
        .cat-dropdown-item-active { font-weight: 600; color: #7c3aed; background: #f5f3ff; }
        .cat-dropdown-divider { height: 1px; background: #e2e8f0; margin: 2px 0; }
        .cat-dropdown-add-btn { color: #7c3aed; font-weight: 500; }
        .cat-dropdown-add { padding: 6px 8px; display: flex; gap: 4px; align-items: center; }
        .cat-add-input { flex: 1; padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; }
        .btn-tiny { padding: 2px 8px; background: #7c3aed; color: #fff; border: none; border-radius: 4px; font-size: 11px; cursor: pointer; }
        .btn-tiny-ghost { padding: 2px 8px; background: transparent; color: #64748b; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 11px; cursor: pointer; }
        /* 그룹 행 */
        .pivot-group-row { background: #f8fafc; font-weight: 600; }
        .pivot-group-row td { padding: 6px 8px; }
        .group-toggle-btn { background: none; border: none; cursor: pointer; font-size: 13px; padding: 0 4px; }
        .group-name-cell { font-size: 13px; }
        .group-name-text { cursor: pointer; }
        .group-name-text:hover { text-decoration: underline; color: #7c3aed; }
        .group-name-input { font-size: 13px; font-weight: 600; padding: 2px 6px; border: 1px solid #7c3aed; border-radius: 4px; outline: none; min-width: 120px; box-shadow: 0 0 0 2px rgba(124,58,237,.15); }
        .group-meta { font-size: 11px; color: #64748b; font-weight: 400; }
        /* 모달 */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 200; display: flex; align-items: center; justify-content: center; }
        .modal-box { background: #fff; border-radius: 12px; padding: 28px 32px; width: 360px; max-width: 90vw; box-shadow: 0 20px 60px rgba(0,0,0,.2); }
        .modal-title { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
        .modal-sub { font-size: 12px; color: #64748b; margin-bottom: 14px; }
        .modal-confirm-text { font-size: 14px; line-height: 1.6; margin-bottom: 8px; }
        .modal-input { width: 100%; padding: 9px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; margin-bottom: 16px; box-sizing: border-box; }
        .modal-input:focus { outline: none; border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.12); }
        .modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
        .btn-primary { padding: 8px 18px; background: #7c3aed; color: #fff; border: none; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .btn-primary:hover { background: #6d28d9; }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-danger { background: #059669; }
        .btn-danger:hover { background: #047857; }
        .btn-secondary { padding: 8px 18px; background: #f1f5f9; color: #374151; border: none; border-radius: 7px; font-size: 13px; cursor: pointer; }
        .btn-secondary:hover { background: #e2e8f0; }
        .loading-overlay { position: fixed; inset: 0; background: rgba(255,255,255,.6); z-index: 300; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 600; color: #7c3aed; }
        /* 그룹에 추가 모달 */
        .group-add-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 20px; max-height: 240px; overflow-y: auto; }
        .group-add-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 8px; cursor: pointer; transition: background .1s; }
        .group-add-item:hover { background: #f8fafc; border-color: #cbd5e1; }
        .group-add-item-active { background: #f5f3ff !important; border-color: #7c3aed !important; }
        .group-add-name { font-size: 14px; font-weight: 500; }
        .group-add-count { font-size: 12px; color: #64748b; }
      `}</style>
    </>
  );
}
