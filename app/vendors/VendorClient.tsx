'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createVendor, updateVendorName, deleteVendor,
  addAlias, deleteAlias, remapAllEntries,
} from './actions';

export type VendorAlias = {
  id:              string;
  vendor_id:       string;
  source_name:     string | null;
  business_number: string | null;
  created_at:      string;
};

export type Vendor = {
  id:          string;
  vendor_name: string;
  created_at:  string;
  vendor_aliases: VendorAlias[];
};

// ── 하위 컴포넌트 ──────────────────────────────────────────────────────────────

function AliasRow({
  alias,
  onDelete,
  isPending,
}: {
  alias:     VendorAlias;
  onDelete:  (id: string) => void;
  isPending: boolean;
}) {
  return (
    <div className="alias-row">
      <span className="alias-type">
        {alias.business_number && (
          <span className="alias-tag alias-tag-biz">사업자 {alias.business_number}</span>
        )}
        {alias.source_name && (
          <span className="alias-tag alias-tag-name">{alias.source_name}</span>
        )}
      </span>
      <button
        className="btn-icon btn-danger-icon"
        onClick={() => onDelete(alias.id)}
        disabled={isPending}
        title="삭제"
      >
        ✕
      </button>
    </div>
  );
}

function AddAliasForm({
  vendorId,
  onDone,
}: {
  vendorId: string;
  onDone:   () => void;
}) {
  const [sourceName,     setSourceName]     = useState('');
  const [businessNumber, setBusinessNumber] = useState('');
  const [err,            setErr]            = useState('');
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    startTransition(async () => {
      const res = await addAlias(
        vendorId,
        sourceName.trim() || null,
        businessNumber.trim() || null,
      );
      if (res.error) { setErr(res.error); return; }
      setSourceName('');
      setBusinessNumber('');
      router.refresh();
      onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="alias-add-form">
      <input
        type="text"
        placeholder="원본 사업자명"
        value={sourceName}
        onChange={e => setSourceName(e.target.value)}
        className="form-input"
      />
      <input
        type="text"
        placeholder="사업자번호"
        value={businessNumber}
        onChange={e => setBusinessNumber(e.target.value)}
        className="form-input"
        style={{ width: 140 }}
      />
      {err && <span className="form-error">{err}</span>}
      <button type="submit" className="btn-sm btn-primary" disabled={isPending}>
        {isPending ? '저장 중…' : '추가'}
      </button>
      <button type="button" className="btn-sm btn-ghost" onClick={onDone}>취소</button>
    </form>
  );
}

function VendorRow({
  vendor,
  onRefresh,
}: {
  vendor:    Vendor;
  onRefresh: () => void;
}) {
  const [editing,       setEditing]      = useState(false);
  const [editName,      setEditName]     = useState(vendor.vendor_name);
  const [showAliases,   setShowAliases]  = useState(false);
  const [showAddAlias,  setShowAddAlias] = useState(false);
  const [err,           setErr]          = useState('');
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleUpdateName(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const fd = new FormData();
    fd.set('vendor_name', editName);
    startTransition(async () => {
      const res = await updateVendorName(vendor.id, fd);
      if (res.error) { setErr(res.error); return; }
      setEditing(false);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm(`"${vendor.vendor_name}" 거래처를 삭제하시겠습니까?\n연결된 원본명도 모두 삭제됩니다.`)) return;
    startTransition(async () => {
      const res = await deleteVendor(vendor.id);
      if (res.error) { setErr(res.error); return; }
      router.refresh();
    });
  }

  function handleDeleteAlias(aliasId: string) {
    startTransition(async () => {
      await deleteAlias(aliasId);
      router.refresh();
    });
  }

  const aliasCount = vendor.vendor_aliases.length;

  return (
    <div className="vendor-row">
      {/* 거래처명 영역 */}
      <div className="vendor-row-main">
        {editing ? (
          <form onSubmit={handleUpdateName} style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
            <input
              autoFocus
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="form-input"
              style={{ flex: 1 }}
            />
            {err && <span className="form-error">{err}</span>}
            <button type="submit" className="btn-sm btn-primary" disabled={isPending}>저장</button>
            <button type="button" className="btn-sm btn-ghost" onClick={() => { setEditing(false); setEditName(vendor.vendor_name); }}>취소</button>
          </form>
        ) : (
          <>
            <span className="vendor-name">{vendor.vendor_name}</span>
            <div className="vendor-actions">
              <button className="btn-sm btn-ghost" onClick={() => setEditing(true)}>수정</button>
              <button className="btn-sm btn-danger" onClick={handleDelete} disabled={isPending}>삭제</button>
            </div>
          </>
        )}
      </div>

      {/* 원본명/사업자번호 영역 */}
      <div className="vendor-row-meta">
        <span
          className="vendor-alias-toggle"
          onClick={() => setShowAliases(v => !v)}
          role="button"
        >
          {showAliases ? '▾' : '▸'} 원본명 {aliasCount}개
        </span>
        <span className="vendor-created-at">
          {vendor.created_at.substring(0, 10)}
        </span>
      </div>

      {showAliases && (
        <div className="vendor-aliases">
          {vendor.vendor_aliases.map(a => (
            <AliasRow
              key={a.id}
              alias={a}
              onDelete={handleDeleteAlias}
              isPending={isPending}
            />
          ))}
          {showAddAlias ? (
            <AddAliasForm
              vendorId={vendor.id}
              onDone={() => { setShowAddAlias(false); onRefresh(); }}
            />
          ) : (
            <button
              className="btn-sm btn-ghost"
              style={{ marginTop: 4 }}
              onClick={() => setShowAddAlias(true)}
            >
              + 원본명/사업자번호 추가
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── 메인 클라이언트 컴포넌트 ──────────────────────────────────────────────────

export default function VendorClient({ initialVendors }: { initialVendors: Vendor[] }) {
  const [search,      setSearch]     = useState('');
  const [showForm,    setShowForm]   = useState(false);
  const [formErr,     setFormErr]    = useState('');
  const [remapResult, setRemapResult] = useState<{ updated: number } | null>(null);
  const [remapErr,    setRemapErr]   = useState('');
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // 검색 필터
  const lower = search.toLowerCase();
  const filtered = lower
    ? initialVendors.filter(v =>
        v.vendor_name.toLowerCase().includes(lower) ||
        v.vendor_aliases.some(
          a => a.source_name?.toLowerCase().includes(lower) ||
               a.business_number?.includes(lower)
        )
      )
    : initialVendors;

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormErr('');
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createVendor(fd);
      if (res.error) { setFormErr(res.error); return; }
      (e.target as HTMLFormElement).reset();
      setShowForm(false);
      router.refresh();
    });
  }

  function handleRemap() {
    setRemapResult(null);
    setRemapErr('');
    startTransition(async () => {
      const res = await remapAllEntries();
      if (res.error) { setRemapErr(res.error); return; }
      setRemapResult({ updated: res.updated });
    });
  }

  return (
    <div className="vendor-page">
      {/* 헤더 */}
      <div className="vendor-header">
        <h1 className="page-title">거래처 관리</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {remapResult && (
            <span className="remap-result">{remapResult.updated}건 재매핑 완료</span>
          )}
          {remapErr && <span className="form-error">{remapErr}</span>}
          <button
            className="btn btn-secondary"
            onClick={handleRemap}
            disabled={isPending}
          >
            {isPending ? '처리 중…' : '기존 거래내역 다시 매핑'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowForm(v => !v)}
          >
            {showForm ? '닫기' : '+ 거래처 등록'}
          </button>
        </div>
      </div>

      {/* 등록 폼 */}
      {showForm && (
        <form onSubmit={handleAdd} className="vendor-add-form">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>거래처 등록</h2>
          <div className="form-row">
            <label className="form-label">거래처명 <span className="required">*</span></label>
            <input name="vendor_name" type="text" className="form-input" required placeholder="예: 써브웨이" />
          </div>
          <div className="form-row">
            <label className="form-label">사업자번호</label>
            <input name="business_number" type="text" className="form-input" placeholder="예: 296-20-01613" />
          </div>
          <div className="form-row">
            <label className="form-label">원본 사업자명</label>
            <input name="source_name" type="text" className="form-input" placeholder="예: 써브웨이 인천송도트리플스트리트점" />
          </div>
          {formErr && <p className="form-error">{formErr}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? '저장 중…' : '저장'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>취소</button>
          </div>
        </form>
      )}

      {/* 검색 */}
      <div className="vendor-search">
        <input
          type="text"
          placeholder="거래처명, 사업자번호, 원본명 검색..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="form-input"
          style={{ width: '100%', maxWidth: 400 }}
        />
        {search && (
          <button className="btn-ghost" onClick={() => setSearch('')} style={{ marginLeft: 6 }}>✕</button>
        )}
        <span className="vendor-count">
          {filtered.length} / {initialVendors.length}개
        </span>
      </div>

      {/* 목록 헤더 */}
      <div className="vendor-list-header">
        <span style={{ flex: 1 }}>거래처명</span>
        <span style={{ width: 80, textAlign: 'right' }}>원본명</span>
        <span style={{ width: 100, textAlign: 'right' }}>등록일</span>
        <span style={{ width: 100, textAlign: 'right' }}>관리</span>
      </div>

      {/* 목록 */}
      {filtered.length === 0 ? (
        <div className="vendor-empty">
          {search ? `"${search}" 검색 결과가 없습니다.` : '등록된 거래처가 없습니다.'}
        </div>
      ) : (
        <div className="vendor-list">
          {filtered.map(v => (
            <VendorRow key={v.id} vendor={v} onRefresh={() => router.refresh()} />
          ))}
        </div>
      )}
    </div>
  );
}
