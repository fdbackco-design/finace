# DB 마이그레이션 계획 (Phase 1)

## 적용 순서

모든 마이그레이션은 **additive** (기존 테이블·컬럼 삭제 없음). 순서대로 실행.

```
010_source_tracking.sql
011_matching_runs.sql
012_finance_audit_logs.sql
```

## 010_source_tracking.sql

**대상**: `source_files`, `bank_transactions`, `card_transactions`, `hometax_invoices`

**추가 사항**:
- `source_files`: 17개 신규 컬럼 (detected_source_type, file_size_bytes, file_content_hash, storage_path, status, 등)
- `source_parse_warnings` 신규 테이블: 파싱 오류 행 보존 (append-only)
- `transaction_source_links` 신규 테이블: 원본 파일 계보 추적 (PRIMARY/DUPLICATE_SOURCE)
- `bank_transactions`, `card_transactions`, `hometax_invoices`: `source_row_number`, `source_sheet_name` 컬럼 추가

**주의사항**:
- Storage 버킷(`finance-raw`): 010 SQL 내 `INSERT INTO storage.buckets ... ON CONFLICT DO NOTHING`으로 자동 생성
- `parser_version` 컬럼은 DEFAULT '1.0'

## 011_matching_runs.sql

**대상**: `matching_runs` (신규), `transaction_matches` (컬럼 추가)

**추가 사항**:
- `matching_runs` 신규 테이블: 매칭 실행 이력 (법인별, 월별)
- `transaction_matches`: `company_id`, `matching_run_id`, `match_status`, `is_active` 컬럼 추가

**주의사항**:
- 기존 `transaction_matches` 행은 신규 컬럼이 NULL (하위 호환)
- SUPERSEDED 처리는 `company_id + matching_run_id` 범위로 한정 (다른 법인 영향 없음)

## 012_finance_audit_logs.sql

**대상**: `finance_audit_logs` (신규)

**추가 사항**:
- 시스템 이벤트 감사 로그 (업로드·파싱·재매칭·설정변경)
- append-only (UPDATE/DELETE 정책 없음)

**기존 history 테이블과 역할 분리**:
| 테이블 | 역할 |
|--------|------|
| `cashflow_entry_history` | cashflow_entry 수동 수정 이력 |
| `vendor_name_history` | 거래처명 수정 상세 이력 |
| `cashflow_groups_history` | 그룹 조작 이력 |
| `finance_audit_logs` (신규) | 시스템 이벤트 감사 |

## Supabase SQL Editor 적용 방법

1. Supabase Dashboard → SQL Editor
2. 각 파일을 순서대로 실행
3. Storage 버킷은 별도로 Dashboard에서 생성

## Rollback 방법

각 파일 하단의 Rollback 주석 참조. **역순**으로 실행:
```
012 rollback → 011 rollback → 010 rollback
```
