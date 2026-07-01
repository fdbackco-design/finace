# SCHEMA-FEEDAX · MVP Data Dictionary v0.1

> REQ-FEEDAX v0.2 요청 산출물 중 **스키마 사전**. 담당: 서지원.
> 정본: `TECH-FEEDAX__Source_Lineage__AS-IS_현행정리__v0.1.md` (본 문서는 §4·§5 스키마를 독립 추출).
> 원천: 마이그레이션 `001 ~ 025`. 보안등급 SECRET. 기준일 2026-07-01.

전 테이블 PK는 `uuid_generate_v4()`. 잔액은 저장하지 않고 View에서 계산.
`company_code` enum: `feedback` · `sangsaeng` · `shootmoon`.

---

## 1. Layer 1 — Source Registry (원천 추적)

### `source_files` (SourceAsset) — 001, 010 보강
| 필드 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| upload_session_id | uuid FK | |
| company_id / company_code | uuid / text | |
| filename | text | |
| file_type / detected_source_type | text | BANK_IBK/WOORI, CARD_IBK/WOORI, HT_* |
| file_size_bytes | bigint | |
| file_content_hash | text | SHA256, 인덱스 |
| storage_path / storage_mime_type | text | `finance-raw` 버킷 |
| duplicate_of | uuid FK→source_files | 재업로드 원본 |
| parser_name / parser_version | text | 기본 '1.0' |
| header_row_number / default_sheet_name | int / text | |
| imported_by / imported_at | text / timestamptz | 기본 'system' |
| status | text CHECK | pending·storage_uploaded·parsing·importing·success·partial·error |
| parse_warning_count / success_row_count / error_row_count / duplicate_row_count | int | |

### `source_parse_warnings` (SourceRow-오류행) — 010
`id, source_file_id FK, source_row_number, source_sheet_name, severity(error/warning/info), error_code, message, raw_row_json(jsonb), created_at`
→ **오류 행만** raw 전체 보존. 정상 행 raw 보존(`parsed_rows`)은 미구현.

### `transaction_source_links` — 010
`id, source_file_id FK, source_row_number, source_sheet_name, {bank/card/hometax}_transaction_id, link_type(PRIMARY/DUPLICATE_SOURCE), created_at`
- CHECK: 3개 거래 FK 중 **정확히 1개** non-null
- UNIQUE: (파일 × 각 거래) 쌍 — idempotent upsert 키

### 원천 3테이블 행추적 컬럼 (bank/card/hometax_transactions에 추가) — 010
`source_row_number`(1-based Excel 행), `source_sheet_name`, `source_file_id`(최초 생성 시만, 재업로드 시 미변경)

---

## 2. Layer 2 — Canonical Layer

### `normalized_transactions` (CanonicalRecord) — 013
| 필드 | 타입 | 비고 |
|---|---|---|
| id, company_id, company_code | | |
| {bank/card/hometax}_transaction_id | uuid FK | CHECK 정확히 1개 + 각 UNIQUE |
| event_type | text CHECK | REALIZED_INFLOW·REALIZED_OUTFLOW·EXPECTED_INFLOW·EXPECTED_OUTFLOW |
| event_date | date | |
| gross_amount | bigint | CHECK > 0 |
| counterparty_name / counterparty_business_no | text | GIN trigram |
| is_projected / projected_at | bool / timestamptz | |

### `cashflow_entries` (표시 계층, 001 + 008 확장)
표시용: `display_category, category_auto, category_manual, category_override, classification_basis, vendor_name_override, amount_status, invoice_amount, actual_amount, accumulated_amount, remaining_amount, actual_date, group_id, group_name, group_order, is_completed, completed_at/by/method, show_in_cashflow`
→ `payment_source_type` CHECK 제약: 빈 문자열은 `|| null`로 변환 필수.

---

## 3. Layer 4/5 — Calculation & Validation

### `cash_events` — 014
`id, company_id/code, normalized_transaction_id FK(1:1 UNIQUE), bank_transaction_id(1:1 UNIQUE, denorm), event_type(INFLOW/OUTFLOW), event_date, gross_amount(>0), account_no, source_type(BANK_IBK/WOORI)`

### `obligations` — 015
| 필드 | CHECK/비고 |
|---|---|
| origin_type | SOURCE_TRANSACTION·CARD_SETTLEMENT_GROUP·FIXED_COST_RULE·MANUAL |
| obligation_type | RECEIVABLE·PAYABLE |
| obligation_subtype | HT_INVOICE·CARD_SETTLEMENT_GROUP·FIXED_COST·MANUAL |
| due_date, gross_amount(>0) | |
| normalized_transaction_id | UNIQUE (HT 1:1) |
| generated_from_fixed_cost_rule_id + fixed_cost_month | UNIQUE(규칙,월) |
| card_settlement_group_key | UNIQUE DEFERRABLE, `{code}||{sourceType}||{due}` |
| is_user_locked/locked_by/at | 자동 재매칭 잠금 |
| is_cancelled/at/reason, is_superseded/at | terminal state |

### `match_allocations` (CalculationResult) — 017
| 필드 | CHECK/비고 |
|---|---|
| cash_event_id, obligation_id | FK |
| allocated_amount | bigint > 0 |
| match_type | FULL·PARTIAL·COMBINED·CARD_SETTLEMENT·FEE_ADJUSTED |
| confidence_score | numeric(5,4) |
| match_reason_codes | text[] |
| date_diff_days | int |
| created_by | ENGINE·HUMAN·RULE |
| allocation_status | PROPOSED·AUTO_CONFIRMED·HUMAN_CONFIRMED·REJECTED·SUPERSEDED |
| review_decision_id | FK→review_decisions (020) |
- UNIQUE(부분): 활성 상태 (cash,obl) 쌍 1개 (`idx_ma_active_unique`)

### `obligation_adjustments` — 018
`obligation_id FK, adjustment_type(WRITE_OFF 등), amount, status(PROPOSED·HUMAN_CONFIRMED·REJECTED), review_decision_id FK, reason`
→ WRITE_OFF 확정은 RPC에서 `actor_role='CEO'` 검증.

### `obligation_source_links` — 016
의무 ↔ 원천(카드 그룹 다건 등) 연결.

---

## 4. Layer 6 — Review & Log

### `review_queue` (ValidationResult) — 019
`review_type`(12종), `priority`(URGENT/NORMAL/LOW), `case_status`(PENDING·IN_REVIEW·RESOLVED·DEFERRED), `obligation_id`/`cash_event_id`(최소 1), `proposed_allocation_id`/`proposed_adjustment_id`, `summary`(한글), `detail_json`, `assigned_to`, `due_date`
→ **review_type 12종:** PARTIAL_PAYMENT · COMBINED_PAYMENT · FEE_DEDUCTION · MULTIPLE_CANDIDATES · DATE_MISMATCH · AMOUNT_MISMATCH · NEW_COUNTERPARTY · UNIDENTIFIED_COUNTERPARTY · OVERDUE_OBLIGATION · UNALLOCATED_CASH · OVER_ALLOCATED · CORRECTION_REQUEST (자동 트리거 5종 / 수동 7종 — 정본 §8)

### `review_decisions` (append-only) — 020
`review_queue_id FK, company_id, decision(APPROVED·REJECTED·DEFERRED·PARTIAL_APPROVE), decision_reason(NOT NULL), actor_id, actor_role(CEO·FINANCE·SYSTEM), decided_at`

### `review_decision_effects` (append-only) — 021
`review_decision_id FK, effect_type, match_allocation_id, obligation_adjustment_id, obligation_id, amount_override`

### `finance_audit_logs` (append-only, AccessLog 부분) — 012, 013 확장
`entity_type(11+7종), entity_id, action_type(15+18종), before_json, after_json, metadata, reason, actor_id, created_at`
→ 시스템 이벤트 감사 전용. 사용자 조회/로그인 로그는 미구현.

### `matching_runs` — 011
`company_id, target_month, engine_version, triggered_by(upload/manual/scheduled), status(running/completed/failed), bank/card/ht_count, auto_matched, manual_review, unmatched_count, deleted/created_count, error_summary`

---

## 5. View & RPC
- `v_obligation_balance` (022): obligations + 확정 allocation/adjustment 합 → `remaining_amount`, `lifecycle_status`(OPEN·PARTIALLY_SETTLED·SETTLED·CANCELLED·SUPERSEDED)
- `v_cash_event_balance` (022): cash_events + 확정 allocation 합 → `unallocated_amount`, `cash_status`(UNALLOCATED·PARTIALLY_ALLOCATED·FULLY_ALLOCATED·OVER_ALLOCATED)
- `process_review_decision(...)` RPC (025): review_decision + effects + 상태변경 + 감사로그를 단일 트랜잭션 원자 처리

## 6. 미해결 스키마 갭
- `parsed_rows`(정상행 raw 보존) · `FinanceTruthCase`(테스트셋) · QueryLog(자연어질의) · AccessLog(조회로그): ⬜ 미구현
- REQ 제안 사람친화 ID(`SA-YYYYMMDD-0001` 등): 미채택(전건 uuid)

_문서 끝 — SCHEMA-FEEDAX MVP Data Dictionary v0.1 / SECRET_
