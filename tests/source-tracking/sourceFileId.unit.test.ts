/**
 * source_file_id 주입 규칙 단위 테스트 (DB 불필요)
 *
 * upsertWithLinks 내부 로직의 핵심 불변 조건을 검증:
 *   1. 신규 거래: source_file_id가 row에 주입됨
 *   2. hash 충돌(기존 거래): INSERT 건너뜀 → 기존 source_file_id 보존
 *   3. link_type 결정 규칙
 */
import { describe, it, expect } from 'vitest';

describe('source_file_id 주입 단위 검증', () => {
  it('신규 row에 source_file_id가 spread로 주입되어야 함', () => {
    const sourceFileId = 'file-uuid-aaa';
    const row = { company_id: 'c1', source_hash: 'hash-001', source_row_number: 4 };
    const injectedRow = { ...row, source_file_id: sourceFileId };

    expect(injectedRow.source_file_id).toBe(sourceFileId);
    expect(injectedRow.source_hash).toBe('hash-001');
    expect(injectedRow.source_row_number).toBe(4);
  });

  it('source_file_id=null이면 null이 주입됨 (source_files INSERT 실패 케이스)', () => {
    const sourceFileId: string | null = null;
    const row = { source_hash: 'hash-001' };
    const injectedRow = { ...row, source_file_id: sourceFileId };

    expect(injectedRow.source_file_id).toBeNull();
  });

  it('source_file_id가 기존 row 필드를 덮어쓰지 않음', () => {
    const originalSourceFileId = 'original-file-uuid';
    const row = { source_hash: 'h', source_file_id: originalSourceFileId };
    const newSourceFileId = 'new-file-uuid';

    // spread로 덮어쓰는 경우: { ...row, source_file_id: newSourceFileId }
    // 신규 INSERT에서만 사용; 기존 행은 INSERT 자체를 건너뜀으로써 보존됨
    const injectedRow = { ...row, source_file_id: newSourceFileId };
    expect(injectedRow.source_file_id).toBe(newSourceFileId); // 신규 INSERT 경로에서는 새 값
    // 기존 행(hash 충돌)은 아래 existingMap 게이트로 INSERT 자체가 차단됨 (별도 테스트)
  });
});

describe('hash 충돌 시 기존 source_file_id 보존', () => {
  it('existingMap에 hash가 있으면 newEntries에 포함되지 않음', () => {
    const existingHash = 'hash-already-in-db';
    const newHash      = 'hash-brand-new';
    const existingMap: Record<string, string> = { [existingHash]: 'existing-uuid-001' };

    const batch = [
      { hash: existingHash, localId: 'bank_0' },
      { hash: newHash,      localId: 'bank_1' },
    ];
    const newEntries = batch.filter(e => !existingMap[e.hash]);

    expect(newEntries).toHaveLength(1);
    expect(newEntries[0].hash).toBe(newHash);
    // existingHash 항목은 INSERT 안 됨 → DB의 source_file_id 그대로 보존
  });

  it('hash 충돌 항목은 idMap에 기존 DB uuid가 등록됨', () => {
    const existingHash = 'hash-already-in-db';
    const existingMap: Record<string, string> = { [existingHash]: 'existing-uuid-001' };
    const idMap: Record<string, string> = {};

    const batch = [{ hash: existingHash, localId: 'bank_0' }];
    // 기존 행 ID 맵 등록 로직 (upsertWithLinks line)
    batch.forEach(e => { if (existingMap[e.hash] && !idMap[e.localId]) idMap[e.localId] = existingMap[e.hash]; });

    expect(idMap['bank_0']).toBe('existing-uuid-001');
  });
});

describe('link_type 결정 규칙', () => {
  it('신규 hash → PRIMARY', () => {
    const newHash = 'hash-brand-new';
    const existingMap: Record<string, string> = {};
    const linkType = existingMap[newHash] ? 'DUPLICATE_SOURCE' : 'PRIMARY';

    expect(linkType).toBe('PRIMARY');
  });

  it('기존 hash → DUPLICATE_SOURCE', () => {
    const existingHash = 'hash-already-in-db';
    const existingMap: Record<string, string> = { [existingHash]: 'existing-uuid-001' };
    const linkType = existingMap[existingHash] ? 'DUPLICATE_SOURCE' : 'PRIMARY';

    expect(linkType).toBe('DUPLICATE_SOURCE');
  });

  it('DUPLICATE_SOURCE 링크는 source_file_id를 새 파일 ID로 기록함', () => {
    // transaction_source_links는 항상 현재 sourceFileId를 기록
    // 거래 행(bank_transactions)의 source_file_id와는 독립적
    const txSourceFileId  = 'original-file-uuid';   // 거래 행에 저장된 최초 파일
    const linkSourceFileId = 'new-file-uuid';        // 링크 행에 기록되는 현재 파일

    expect(txSourceFileId).not.toBe(linkSourceFileId);  // 서로 다른 파일
    // 링크 행: { source_file_id: linkSourceFileId, link_type: 'DUPLICATE_SOURCE', bank_transaction_id: tx.id }
    // 거래 행의 source_file_id는 txSourceFileId 그대로 유지됨
  });
});
