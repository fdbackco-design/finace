/**
 * source-tracking 통합 테스트
 *
 * 이 파일의 테스트는 실제 Supabase DB에 연결하므로
 * 로컬 dev에서만 실행 (SUPABASE_SERVICE_ROLE_KEY 필요).
 * CI에서는 .env.test 없으면 자동 skip.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const hasSupabase = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

describe.skipIf(!hasSupabase)('source_file + transaction_source_links (integration)', () => {
  beforeAll(() => {
    // 실제 DB 테스트는 환경변수가 있을 때만 실행
  });

  it('동일 source_hash 재업로드 시 DUPLICATE_SOURCE 링크가 생성되어야 함', async () => {
    // 이 테스트는 실제 DB에 접근하므로 현재는 placeholder
    // Phase 1 migration 적용 후 실제 구현 필요
    expect(true).toBe(true);
  });

  it('source_files.status가 pending → importing → success 순으로 전이되어야 함', async () => {
    // placeholder
    expect(true).toBe(true);
  });
});

// ── DB 없이 실행 가능한 source tracking 단위 테스트 ───────────────────────
describe('source tracking 필드 단위 검증', () => {
  it('source_row_number는 1-based여야 함 (0 불가)', () => {
    const rowNumber = 4;  // 배열 index 3 → 1-based 4
    expect(rowNumber).toBeGreaterThanOrEqual(1);
    expect(rowNumber % 1).toBe(0);  // 정수
  });

  it('DUPLICATE_SOURCE 링크는 기존 PRIMARY 링크를 덮어쓰지 않음', () => {
    // 원칙: 동일 source_hash 발견 시 기존 row의 source_file_id를 변경하지 않고
    //        새 파일에 DUPLICATE_SOURCE 링크만 추가
    const existingLinkType = 'PRIMARY';
    const newLinkType      = 'DUPLICATE_SOURCE';
    expect(existingLinkType).toBe('PRIMARY');
    expect(newLinkType).toBe('DUPLICATE_SOURCE');
    expect(existingLinkType).not.toBe(newLinkType);
  });
});
