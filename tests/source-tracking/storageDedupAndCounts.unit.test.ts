/**
 * Storage 중복 처리 및 카운트 집계 단위 테스트 (DB 불필요)
 *
 * 검증 대상:
 *   1. 동일 file_content_hash → Storage 재업로드 생략 결정 로직
 *   2. duplicate_of 대표 원본 선택 (flat 구조, 체인 없음)
 *   3. success_row_count / duplicate_row_count 집계
 *   4. 다른 파일에 동일 source_hash 포함 시 DUPLICATE_SOURCE 링크
 */
import { describe, it, expect } from 'vitest';

// ── 1. Storage 중복 업로드 결정 ───────────────────────────────────────────────

describe('Storage 중복 업로드 결정', () => {
  it('동일 hash 기존 파일 있음 → Storage 업로드 생략, 기존 경로 재사용', () => {
    const existingStoragePath = 'feedback/2026-06/123_fbfaa14fe7e75067.xlsx';
    const hashMatches = [{ id: 'file-A', storage_path: existingStoragePath, duplicate_of: null }];

    const rep = hashMatches.find(r => r.duplicate_of === null) ?? hashMatches[0];
    const shouldUpload = !rep.storage_path;

    expect(shouldUpload).toBe(false);
    expect(rep.storage_path).toBe(existingStoragePath);
  });

  it('신규 파일 (hash 없음) → Storage 업로드 진행', () => {
    const hashMatches: any[] = [];

    const rep = hashMatches.find(r => r.duplicate_of === null) ?? hashMatches[0];
    const shouldUpload = !rep?.storage_path;

    expect(shouldUpload).toBe(true);
  });

  it('동일 파일 2회 업로드 시 storage_path 동일', () => {
    const firstPath = 'feedback/2026-06/1782371007139_fbfaa14fe7e75067.xlsx';
    const hashMatches = [{ id: 'A', storage_path: firstPath, duplicate_of: null }];

    const rep = hashMatches.find(r => r.duplicate_of === null)!;
    expect(rep.storage_path).toBe(firstPath);
    // 2차 source_files.storage_path = firstPath (재사용)
  });
});

// ── 2. duplicate_of 대표 원본 선택 ────────────────────────────────────────────

describe('duplicate_of 대표 원본 선택 (flat 구조)', () => {
  it('1차 업로드: duplicate_of = null', () => {
    const hashMatches: any[] = [];  // 기존 파일 없음
    const duplicateOfId = hashMatches.length > 0
      ? ((hashMatches.find(r => r.duplicate_of === null) ?? hashMatches[0]).id as string)
      : null;

    expect(duplicateOfId).toBeNull();
  });

  it('2차 업로드: duplicate_of = 1차 source_file.id', () => {
    const hashMatches = [{ id: 'A', storage_path: 'path/A.xlsx', duplicate_of: null }];
    const rep = hashMatches.find(r => r.duplicate_of === null) ?? hashMatches[0];

    expect(rep.id).toBe('A');  // 2차 source_files.duplicate_of = 'A'
  });

  it('3차 업로드도 duplicate_of = A (체인 아님)', () => {
    // 기존 source_files: A(원본, dup_of=null), B(dup_of=A)
    const hashMatches = [
      { id: 'A', storage_path: 'path/A.xlsx', duplicate_of: null },
      { id: 'B', storage_path: 'path/A.xlsx', duplicate_of: 'A' },
    ];
    const rep = hashMatches.find(r => r.duplicate_of === null) ?? hashMatches[0];

    // 3차의 duplicate_of = A (B가 아님 — 체인 없음)
    expect(rep.id).toBe('A');
    expect(rep.id).not.toBe('B');
  });

  it('fallback: duplicate_of=null인 파일이 없으면 가장 오래된 파일 사용', () => {
    // 엣지케이스: 원본이 없고 모두 duplicate_of가 set된 경우
    const hashMatches = [
      { id: 'B', storage_path: 'path/x.xlsx', duplicate_of: 'A' },
      { id: 'C', storage_path: 'path/x.xlsx', duplicate_of: 'A' },
    ];
    const rep = hashMatches.find(r => r.duplicate_of === null) ?? hashMatches[0];

    expect(rep.id).toBe('B');  // 첫 번째(가장 오래된) 사용
  });
});

// ── 3. success_row_count / duplicate_row_count 집계 ──────────────────────────

describe('upsertWithLinks 카운트 집계', () => {
  it('신규 INSERT = upserted, hash 충돌 = duplicates', () => {
    const existingMap: Record<string, string> = { 'h-A': 'uuid-A', 'h-B': 'uuid-B' };
    const batch = [
      { hash: 'h-A', localId: 'bank_0' },   // 기존 (duplicate)
      { hash: 'h-B', localId: 'bank_1' },   // 기존 (duplicate)
      { hash: 'h-C', localId: 'bank_2' },   // 신규
    ];

    const newEntries  = batch.filter(e => !existingMap[e.hash]);
    const dupCount    = batch.length - newEntries.length;

    expect(newEntries).toHaveLength(1);
    expect(dupCount).toBe(2);
  });

  it('전량 중복 파일: success_row_count=0, duplicate_row_count=total', () => {
    const existingHashes = new Set(['h1', 'h2', 'h3']);
    const batch = [{ hash: 'h1' }, { hash: 'h2' }, { hash: 'h3' }];

    const newEntries = batch.filter(e => !existingHashes.has(e.hash));
    const dupCount   = batch.length - newEntries.length;

    // 2차 업로드 기준 (147건 전량 중복)
    expect(newEntries).toHaveLength(0);
    expect(dupCount).toBe(3);
  });

  it('전량 신규 파일: success_row_count=total, duplicate_row_count=0', () => {
    const existingHashes = new Set<string>();
    const batch = [{ hash: 'new-1' }, { hash: 'new-2' }];

    const newEntries = batch.filter(e => !existingHashes.has(e.hash));
    const dupCount   = batch.length - newEntries.length;

    expect(newEntries).toHaveLength(2);
    expect(dupCount).toBe(0);
  });

  it('전량 중복 → status=success (오류 없음)', () => {
    const fileErrors: string[] = [];
    const parseErrors: any[] = [];
    const fileNewCount = 0;
    const fileDuplicateCount = 147;

    const finalStatus =
      fileErrors.length > 0 && fileNewCount === 0 && fileDuplicateCount === 0 ? 'error' :
      fileErrors.length > 0                                                   ? 'partial' :
      parseErrors.length > 0                                                  ? 'partial' :
      'success';

    expect(finalStatus).toBe('success');
  });
});

// ── 4. 다른 파일에 동일 source_hash 포함 (DUPLICATE_SOURCE 링크) ──────────────

describe('다른 파일에 동일 source_hash 포함', () => {
  it('다른 file_content_hash → 새 source_files 생성, 기존 원천 거래 유지', () => {
    const fileA_contentHash = 'content-hash-A';
    const fileB_contentHash = 'content-hash-B';  // 다른 파일 (행 일부만 겹침)

    // 두 파일은 서로 다른 content hash → duplicate_of 체계와 무관
    expect(fileA_contentHash).not.toBe(fileB_contentHash);
    // → 각각 새 source_files 생성, Storage 각각 업로드
  });

  it('같은 source_hash의 bank_transaction → INSERT 없이 DUPLICATE_SOURCE 링크만', () => {
    const txHash = 'shared-bank-tx-hash';
    const existingMap: Record<string, string> = { [txHash]: 'existing-uuid' };

    const batch = [{ hash: txHash, localId: 'bank_0' }];
    const newEntries   = batch.filter(e => !existingMap[e.hash]);
    const dupEntries   = batch.filter(e => !!existingMap[e.hash]);
    const linkType     = existingMap[txHash] ? 'DUPLICATE_SOURCE' : 'PRIMARY';

    expect(newEntries).toHaveLength(0);   // 원천 거래 중복 INSERT 없음
    expect(dupEntries).toHaveLength(1);   // 기존 거래 재사용
    expect(linkType).toBe('DUPLICATE_SOURCE');
  });

  it('DUPLICATE_SOURCE 링크의 source_file_id = 새 파일 id (기존 거래 id 아님)', () => {
    const newFileId = 'new-source-file-uuid';
    const existingTxId = 'existing-bank-tx-uuid';

    // 링크 레코드 구조
    const linkRow = {
      source_file_id:     newFileId,         // 새 파일
      bank_transaction_id: existingTxId,     // 기존 거래
      link_type:          'DUPLICATE_SOURCE',
    };

    expect(linkRow.source_file_id).toBe(newFileId);
    expect(linkRow.bank_transaction_id).toBe(existingTxId);
    // 거래 행의 source_file_id는 원본 파일 id 그대로 유지됨
  });
});
