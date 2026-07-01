# FEED AX CORE — Source Lineage MVP · 현행 시스템 정리 (AS-IS)

> **REQ-FEEDAX Source Lineage MVP Technical Update v0.2 (2026-W27)** 요청서의 형식에 맞춰
> **현재 실제 구현된 자금수지현황 시스템**을 각 요구사항 항목에 매핑하여 정리한 문서.
> 요청서가 "무엇을 만들어야 하는가"라면, 이 문서는 "지금 무엇이 만들어져 있는가"이다.

| 항목 | 내용 |
|---|---|
| 문서 코드 | AS-IS-FEEDAX__Source Lineage 현행 정리__v0.1 |
| 문서 성격 | Technical Requirement(REQ v0.2) → 현행 구현 대조표 |
| 기준 요청 문서 | REQ-FEEDAX__Source Lineage MVP Technical Update__v0.2 / 2026-W27 |
| 대상 시스템 | 자금수지현황 시스템 (피드백 · 상생 · 슛문 3사) |
| 스택 | Next.js 16.2.9 (App Router) · React 19.2.7 · Supabase(PostgreSQL, service_role) · Vercel |
| 마이그레이션 | 001 ~ 025 (Phase 1 원천추적 + Phase 2A 의무/배분/검토 계층) |
| 보안등급 | SECRET / 실데이터 연결 시 RESTRICTED |
| 작성 기준일 | 2026-07-01 |

**범례:** ✅ 구현 완료 · 🟡 부분 구현 · ⬜ 미구현

---

## 1. Executive Summary — 현행 요약

| 구분 | 요청(REQ v0.2) | 현행 시스템 |
|---|---|---|
| 최종 목표 | 원본→계산→검증→로그 최소 신뢰 계층 | ✅ 원천추적(Phase1) + 정규화·의무·배분·검토(Phase2A) 계층이 DB로 구현됨 |
| 데이터 구조 | SourceAsset/SourceRow/CalculationResult | 🟡 대응 테이블 존재(명칭 상이). `source_files` / 원천 3테이블+`source_row_number` / `match_allocations` |
| QueryLog/AccessLog | 질의·접근 로그 설계 | 🟡 `finance_audit_logs`(시스템 이벤트) 있음 · 자연어질의 로그/조회 접근로그는 ⬜ |
| 검증 기준 | Finance Truth 5건 테스트셋 | ⬜ 명시적 테스트셋/기준값 테이블 없음. 대응 기능은 존재(§8) |
| 안전 기준 | 읽기전용·제한View·외부AI 금지 | 🟡 외부 AI 미사용(유출 벡터 없음) · 읽기전용 View 존재 · 제한 View/컬럼 마스킹은 ⬜ |
| 하지 않을 것 | 자유형 AI 채팅·자동정산·원본수정 | ✅ AI 채팅 없음 · 원본 불변 원칙 구현 · 자동 정산 미반영(검토 승인 필요) |

**한 문장으로:** 현행 시스템은 **자유형 AI 없이 결정론적 파서 + 매칭 엔진**으로 동작하며,
원본성·계보성 골격은 이미 DB 계층에 구현되어 있다. 반면 **자연어 질의(Text-to-SQL), Finance Truth
테스트셋, 역할 기반 접근권한, 통합 결과표 UX**는 아직 미구현 상태다.

---

## 2. 요청(4-B) → 현행 구현 매핑표

| 요청 산출물(REQ) | 현행 대응 | 상태 |
|---|---|---|
| Source Lineage Technical Spec | `docs/architecture/target-data-lineage.md` + 본 문서 | 🟡 |
| MVP Data Dictionary | 마이그레이션 001~025 스키마 (§5) | ✅ |
| Lineage Data Flow (등록→표준화→질의→검증→결과) | 업로드 파이프라인 + Phase2 투영 서비스 (§6) | 🟡 (질의 단계 없음) |
| Lineage Result Table (결과표 샘플) | `/cashflow` 자금수지현황 피벗 등 (§9) | 🟡 |
| 7-Day Sprint Backlog | — (별도 백로그 없음) | ⬜ |
| P0 Security Review | 단일 관리자 인증 + RLS (§10, §13) | 🟡 |

---

## 3. 시스템 아키텍처 (현행) — 6계층 대조

REQ의 6-Layer 모델에 현행 구현을 매핑.

| 계층 | REQ 정의 | 현행 구현 | 상태 |
|---|---|---|---|
| **Layer 1** Source Registry | 원본파일·시트·행·해시·보안등급 | `source_files`(content_hash, storage_path, parser_version, status), `source_parse_warnings`(오류행 raw_row_json), `transaction_source_links`(PRIMARY/DUPLICATE_SOURCE), 원천 3테이블 `source_row_number`/`source_sheet_name` | ✅ |
| **Layer 2** Canonical Layer | 날짜·거래처·금액·카테고리·증빙·원본링크 | `normalized_transactions`(event_type, event_date, gross_amount, counterparty_name/business_no), `cashflow_entries`(display_category, classification_basis) | ✅ |
| **Layer 3** Query Layer | 읽기전용 View·자연어질의·SQL안전규칙 | 읽기전용 View `v_obligation_balance`·`v_cash_event_balance` ✅ / 자연어질의(Text-to-SQL) ⬜ / 제한 View·컬럼 마스킹 ⬜ | 🟡 |
| **Layer 4** Calculation Layer | 계산식·필터·참조레코드·결과값 | 매칭 엔진 `engine.ts`(step1~5), Phase2 `proposeAllocations`(설계상 9조건, **실질 4조건** — 발견 A/B §8), `projectObligation`, `balanceQueries`. 근거: `match_reason_codes`, `confidence_score`, `date_diff_days` | 🟡 |
| **Layer 5** Validation Layer | 기준값·불일치·예외·검토필요 | `review_queue`(12 review_type), `obligation_adjustments`, `detectOverdue`, allocation/obligation 상태머신. Finance Truth 기준값 대조 ⬜ | 🟡 |
| **Layer 6** Explain Layer | 답변값·근거·검증상태·로그 출력 | `/cashflow` UI, `matching_runs`(실행요약), `finance_audit_logs`(감사). QueryLog(질의로그)·AccessLog(조회로그) ⬜ | 🟡 |

**현행 데이터 흐름:**
```
원본 xlsx/csv
 → POST /api/upload
 → finance-raw 버킷 저장 + source_files 등록 (해시 dedup)
 → parseUploadedFile()  : detectFileType → 파서 라우팅
 → importUploadedResults(): 원천 3테이블 upsert + transaction_source_links
 → runRematch(month)    : 매칭 엔진 재실행 → cashflow_entries 재생성
 ─────────────── (Phase 2A 정규화 계층) ───────────────
 → projectNT()          : 원천 → normalized_transactions
 → projectCashEvent()   : 은행 실현거래 → cash_events
 → projectObligation()  : HT/카드그룹/고정비 → obligations
 → proposeAllocations() : cash_events ↔ obligations 배분 제안/자동확정
 → detectOverdue()      : 예정일 경과 미정산 탐지 → review_queue
 → process_review_decision() RPC : 사람 검토 결정 원자적 반영
```

---

## 4. 데이터 객체와 관계 (현행)

REQ 제안 객체 ↔ 현행 테이블 대응.

| REQ 객체 | 현행 테이블 | 상태 | 비고 |
|---|---|---|---|
| SourceAsset | `source_files` | ✅ | 파일 단위 · 해시·상태·파서버전 보강(010) |
| SourceSheet | (전용 테이블 없음) | 🟡 | `source_files.default_sheet_name` + 각 행의 `source_sheet_name` 컬럼으로 대체 |
| SourceRow | 원천 3테이블 `source_row_number`/`source_sheet_name` + `source_parse_warnings.raw_row_json` | 🟡 | **오류 행**만 raw 전체 보존. 정상 행 raw 전체 보존(`parsed_rows`)은 미구현 |
| CanonicalRecord | `normalized_transactions` (+ `cashflow_entries`) | ✅ | 표준 필드로 정규화 |
| TransformStep | (전용 테이블 없음) | 🟡 | `parser_name`/`parser_version` + `classification_basis` + `finance_audit_logs`로 부분 대체 |
| CalculationResult | `match_allocations` + `matching_runs` + 잔액 View | ✅ | N:M 배분·신뢰도·실행요약 |
| ValidationResult | `review_queue` + `obligation_adjustments` | 🟡 | 사람 검토 큐. Finance Truth 대조는 없음 |
| QueryLog | — | ⬜ | 자연어질의 자체가 없음 |
| AccessLog | `finance_audit_logs` (부분) | 🟡 | **시스템 이벤트** 감사만. 사용자 조회/로그인 접근로그 없음 |
| FinanceTruthCase | — | ⬜ | 기준 테스트셋 테이블 없음 |

**추가 현행 핵심 테이블(REQ에 없던 확장):** `cash_events`, `obligations`, `obligation_source_links`,
`review_decisions`(append-only), `review_decision_effects`(append-only), `transaction_matches`,
`cashflow_groups`, `vendors`/`vendor_aliases`.

**ID 규칙 차이:** REQ는 사람이 읽는 ID(`SA-YYYYMMDD-0001`)를 제안하나, 현행은 전 테이블 `uuid_generate_v4()`.
단, `source_row_number`는 **1-based Excel 행번호**로 사용자가 원본에서 직접 찾을 수 있게 보존됨.

---

## 5. Data Dictionary — 현행 최소 필드

| 객체(테이블) | 현행 주요 필드 |
|---|---|
| `source_files` | filename, file_type, detected_source_type, file_content_hash, storage_path, parser_name, parser_version, status(pending~success/partial/error), success/error/duplicate_row_count, imported_by, imported_at |
| `source_parse_warnings` | source_file_id, source_row_number, source_sheet_name, severity(error/warning/info), error_code, message, raw_row_json |
| `transaction_source_links` | source_file_id, source_row_number, {bank/card/ht}\_transaction_id, link_type(PRIMARY/DUPLICATE_SOURCE) |
| `normalized_transactions` | company_id, {bank/card/ht}\_id(정확히 1개), event_type(REALIZED/EXPECTED × IN/OUT), event_date, gross_amount, counterparty_name/business_no, is_projected |
| `cash_events` | normalized_transaction_id(1:1), bank_transaction_id, event_type(INFLOW/OUTFLOW), event_date, gross_amount, source_type(BANK_IBK/WOORI) |
| `obligations` | origin_type(SOURCE_TRANSACTION/CARD_SETTLEMENT_GROUP/FIXED_COST_RULE/MANUAL), obligation_type(RECEIVABLE/PAYABLE), due_date, gross_amount, counterparty, is_user_locked, is_cancelled, is_superseded |
| `match_allocations` | cash_event_id, obligation_id, allocated_amount, match_type(FULL/PARTIAL/COMBINED/CARD_SETTLEMENT/FEE_ADJUSTED), confidence_score, match_reason_codes[], created_by(ENGINE/HUMAN/RULE), allocation_status |
| `obligation_adjustments` | obligation_id, adjustment_type(WRITE_OFF 등), amount, status(PROPOSED/HUMAN_CONFIRMED/REJECTED), review_decision_id |
| `review_queue` | review_type(12종), priority, case_status(PENDING/IN_REVIEW/RESOLVED/DEFERRED), obligation_id/cash_event_id, summary(한글), detail_json |
| `review_decisions` | review_queue_id, decision(APPROVED/REJECTED/DEFERRED/PARTIAL_APPROVE), decision_reason(필수), actor_id, actor_role(CEO/FINANCE/SYSTEM), decided_at | 
| `finance_audit_logs` | entity_type, entity_id, action_type, before_json, after_json, metadata, reason, actor_id, created_at (append-only) |

잔액은 본 테이블에 저장하지 않고 View(`v_obligation_balance`, `v_cash_event_balance`)에서 실시간 계산.

---

## 6. 원본파일 등록과 표준화 흐름 (현행)

| 단계 | REQ 요구 | 현행 구현 | 상태 |
|---|---|---|---|
| 1. 접수 | 파일명·작성자·버전·보안등급·원장ID | `source_files` INSERT + `detectFileType` + `extractAccountHolder`(예금주→회사 자동판별) | ✅ (보안등급/원장ID 필드는 없음 🟡) |
| 2. 보관 | 원본 불수정 + 해시 기록 | `finance-raw` 비공개 버킷 저장 + `file_content_hash`(SHA256) + `source_hash` 행 dedup | ✅ |
| 3. 파싱 | 시트/행/열 추출, 실패는 Parse Error | 7개 파서(`parseBankIbk` 등) + `status=partial/error` + `source_parse_warnings` | ✅ |
| 4. 표준화 | Canonical 매핑, 규칙 TransformStep 기록 | `projectNT` → `normalized_transactions` + `autoClassify`(classification_basis) | ✅ (TransformStep 전용기록 🟡) |
| 5. 검증 | 기준값 대조, 불일치/중복/누락 플래그 | source_hash dedup, DUPLICATE_SOURCE link, `detectOverdue`, `review_queue`. Finance Truth 기준값 대조 없음 | 🟡 |
| 6. 출력 | 답변값·원본·계산식·검증상태 표시 | `/cashflow` 등 화면 (통합 결과표는 부분) | 🟡 |

**원본성 보호 규칙 — 현행 준수 상태:**
- ✅ 원본파일 자동 수정 안 함 (버킷 저장 후 불변)
- ✅ 정제 데이터는 별도 Canonical(`normalized_transactions`)에 분리
- ✅ 원본행↔표준레코드 ID 연결 (`source_file_id`·`source_row_number`는 재업로드 시에도 덮어쓰지 않음)
- ✅ 파싱 실패/중복은 조용히 보정하지 않고 예외 기록 (`source_parse_warnings`, `DUPLICATE_SOURCE`)

---

## 7. Text-to-SQL Guardrail — 현황 ⬜ (전면 미구현)

**현재 자연어 질의(Text-to-SQL) 기능 자체가 없다.** 사용자는 SQL을 실행할 수 없고,
모든 데이터는 사전 정의된 API 라우트와 화면을 통해서만 조회된다. 따라서 일부 안전 요구는
"기능 부재"로 자동 충족되고, 일부는 아직 설계되지 않았다.

| 영역 | REQ 요구 | 현행 |
|---|---|---|
| SQL Scope | SELECT만 허용 | ✅ 사용자 SQL 경로 없음 (쓰기 명령 노출 불가) |
| Data Scope | 허용 View만 조회 | 🟡 읽기전용 View 존재하나, 서버는 service_role로 원본 테이블 직접 접근 |
| Column Scope | 민감 컬럼 마스킹 | ⬜ |
| Row Scope | 기간/권한별 제한 | ⬜ (단일 관리자 · 행 단위 격리 없음) |
| Execution | 실행 전 안전검사 | N/A (동적 쿼리 없음) |
| Logging | 질문/SQL/결과 저장(QueryLog) | ⬜ |
| Human Review | 고위험 질의 승인 | 🟡 매칭 검토(`review_queue`)는 있으나 질의 승인 개념은 아님 |

> **판단:** 자연어 질의 계층은 향후 구현 시 이 표가 곧 P0 체크리스트가 된다. 현재는
> "AI가 실데이터를 다루지 않음"으로 리스크가 낮은 상태.

---

## 8. Finance Truth 검증 — 현행 대응

Finance Truth 5건에 대한 **명시적 테스트셋/기준값 테이블은 없다(⬜)**. 다만 각 케이스가 요구하는
검증 로직은 이미 시스템 기능으로 존재한다.

| Case | REQ 검증 포인트 | 현행 대응 기능 | 상태 |
|---|---|---|---|
| FT-001 정상 매출/정산 | 기간·거래처합계·원본금액 일치 | `proposeAllocations` FULL 매칭(금액오차 ≤10원, 날짜 ≤3일) | 🟡 |
| FT-002 광고/마케팅 비용 | 카테고리 분류·증빙 연결 | `autoClassify` → `display_category`/`classification_basis` | 🟡 |
| FT-003 수수료/외주/인건비 | 계정성격 분류 | `match_type=FEE_ADJUSTED`, `stepSalary`(급여 그룹) | 🟡 |
| FT-004 환불/차감/보정 | 음수·보정·차감 로직 | `obligation_adjustments`(WRITE_OFF 등, CEO 승인 필요) | 🟡 |
| FT-005 중복/누락/증빙불일치 | 예외 탐지·검토 플래그 | `source_hash` dedup, `DUPLICATE_SOURCE`, `detectOverdue`, `review_queue` | ✅ |

**검증 상태값 비교:**

| REQ 제안 | 현행 실제 상태머신 |
|---|---|
| MATCH / MISMATCH / NEEDS_REVIEW / MISSING_EVIDENCE / DUPLICATE_SUSPECT | `allocation_status`: PROPOSED·AUTO_CONFIRMED·HUMAN_CONFIRMED·REJECTED·SUPERSEDED · `obligation lifecycle`: OPEN·PARTIALLY_SETTLED·SETTLED·CANCELLED·SUPERSEDED · `cash_status`: UNALLOCATED·PARTIALLY_ALLOCATED·FULLY_ALLOCATED·OVER_ALLOCATED · `review_type` 12종 |

> ✅ **"불일치를 숨기지 않는다" 원칙 준수:** 자동확정 조건 중 하나라도 실패하면
> `AUTO_CONFIRMED`가 아닌 `PROPOSED` + `review_queue` 등록으로 사람 검토를 강제한다.

**자동확정 9조건 — 명세 vs 실제 (`proposeAllocations.ts`)**

`checks.every(passed)`가 true여야 `AUTO_CONFIRMED`. 9개 중 실제 판정은 4개뿐:

| # | code | 실제 판정 |
|---|---|---|
| 1 | SAME_COMPANY | 하드코딩 `true` (쿼리가 company_id 필터) |
| 2 | DIRECTION_MATCH | ✅ INFLOW↔RECEIVABLE / OUTFLOW↔PAYABLE |
| 3 | AMOUNT_EXACT | ✅ `|gross − remaining| ≤ 10원` |
| 4 | DATE_WITHIN_3D | ✅ `|event_date − due_date| ≤ 3일` |
| 5 | VENDOR_STRONG_MATCH | 판정식 존재하나 항상 실패 (발견 B) |
| 6 | SINGLE_CANDIDATE | 하드코딩 `true` (post-filter 부재) |
| 7 | SINGLE_ALLOCATION | 하드코딩 `true` (동일) |
| 8 | NOT_PARTIAL_PAYMENT | 조건 3과 동일 식 (중복) |
| 9 | NO_PARSE_WARNINGS | 하드코딩 `true` |

> ⚠️ **발견 A:** 실질 판정은 4개(2·3·4·5). 6·7번(단일 후보/배분)은 N:N 오배분 방지 핵심 가드인데 no-op.
> `idx_ma_active_unique`는 동일 (cash,obl) **쌍** 중복만 막고, "1 입금 → N 의무 동시 자동확정"은 못 막음.
>
> ⚠️ **발견 B:** `cash_events`에 거래처 컬럼 없음 + `v_cash_event_balance` select에 `counterparty_name`
> 미포함 → `vendorMatch`가 항상 `0.5` → `VENDOR_STRONG_MATCH`(≥0.8) **항상 실패** → AND 조건이므로
> **`AUTO_CONFIRMED`가 현재 배선상 전혀 발화하지 않음**(전건 `PROPOSED` + `review_queue`행). 자동확정 경로는 현재 죽은 코드.
> 수정: cash_event에 NT 거래처 조인 + 6·7번 post-filter 구현 필요.

**review_type 12종 중 자동 트리거는 5종:**
`AMOUNT_MISMATCH`·`DATE_MISMATCH`·`UNIDENTIFIED_COUNTERPARTY`·`MULTIPLE_CANDIDATES`(6번 `true`로 실발화 안 됨)는
`proposeAllocations.determineReviewType`, `OVERDUE_OBLIGATION`은 `detectOverdue`(연체>30일 시 URGENT)에서 생성.
나머지 7종(PARTIAL_PAYMENT·COMBINED_PAYMENT·FEE_DEDUCTION·NEW_COUNTERPARTY·UNALLOCATED_CASH·OVER_ALLOCATED·CORRECTION_REQUEST)은
enum만 정의, `POST /api/v2/review-queue` 수동 생성만 가능.

---

## 9. 결과표와 응답 UX — 현행 화면

| REQ 블록 | 현행 화면/데이터 | 상태 |
|---|---|---|
| Answer (요약 결과값) | `/cashflow` 자금수지현황 월별 피벗, `/dashboard` | ✅ |
| Source (원본 파일/시트/행) | DB에 `source_row_number`/`source_file_id` 보존, UI 노출은 부분 | 🟡 |
| Formula (계산식·필터) | `match_reason_codes`·`confidence_score` 저장, 화면 표시는 부분 | 🟡 |
| Validation (검증상태) | 매칭완료/미매칭 페이지, allocation 상태 | 🟡 |
| Exception (불일치/누락/중복) | `/unmatched`, `review_queue`(UI는 부분) | 🟡 |
| Log (질의/접근 로그) | `matching_runs`·`finance_audit_logs`(전용 뷰어 없음) | 🟡 |

**현행 페이지:** `/`(홈) · `/login` · `/upload` · `/cashflow` · `/cashflow/matched` ·
`/unmatched` · `/transactions` · `/dashboard` · `/interest` · `/vendors`

**현행 API:** `auth/login`·`auth/logout` · `upload` · `cashflow/*`(categories, complete, groups,
rematch, [id]/vendor·category·restore) · `v2/*`(cash-events, obligations, review-queue, review-decisions) ·
`db-check`·`env-check`

> **갭:** REQ가 요구하는 "Answer+Source+Formula+Validation+Exception+Log **한 화면 통합 결과표**"는
> 데이터는 대부분 확보되어 있으나 **단일 통합 UI로는 미구현**.

---

## 10. 보안과 접근권한 — 현행

**등급 체계:** REQ의 PUBLIC/INTERNAL/SECRET/RESTRICTED 4단계 분리는 ⬜ 미구현.
현행은 단일 관리자 인증만 존재.

| REQ 접근권한 대상 | 현행 |
|---|---|
| 송해민 / 이명진 / 서지원 / 최승희 / 경영지원부 / 상생 (역할별) | ⬜ **역할 기반 접근제어(RBAC) 미구현** — 단일 관리자 계정(`ADMIN_USERNAME`/`ADMIN_PASSWORD`)만 존재 |

**현행 인증/보안 구현:**
- ✅ 로그인: env 기반 단일 관리자, HMAC-SHA256 서명 쿠키(`finance_auth`, 7일), timing-safe 비교
- ✅ `SUPABASE_SERVICE_ROLE_KEY`는 서버 전용 (브라우저 미노출), RLS 우회
- 🟡 RLS: 두 세대 공존. Phase1(`001`) 11개 테이블은 `auth.role()='authenticated'`(service_role 미명시),
  `004`/`008`/`010~024`는 `auth.role() IN ('authenticated','service_role')`. **어느 정책에도 `company_id` 조건 없음 → 법인별 행 격리 전무**
- ⚠️ **RLS 사실상 휴면:** 앱이 Supabase Auth를 쓰지 않고(자체 HMAC 쿠키) 브라우저에 `authenticated` JWT가
  없음 → anon 클라이언트 직접 조회는 전부 차단. 실질 보안 경계는 "① 자체 로그인 쿠키 + ② 서버 전용 service_role(RLS 우회)" 2겹
- ✅ append-only 테이블(`finance_audit_logs`·`review_decisions`·`review_decision_effects`·`source_parse_warnings`·`transaction_source_links`)은 UPDATE/DELETE 정책 없음
- ✅ 삭제는 `service_role`만, `review_decisions`/`finance_audit_logs`는 append-only
- ✅ `WRITE_OFF` 조정은 RPC에서 `actor_role='CEO'` 검증 (단, actor_role은 앱 계층이 주입)
- ✅ 외부 AI 미사용 → 실재무자료 외부 전송 벡터 없음
- ✅ `finance-raw` 비공개 버킷, 원본 열람 signed URL은 Phase 2+ (미구현)

---

## 11. 구현 현황 요약 (REQ 7-Day 산출물 대비)

| REQ 산출물 | 현행 상태 |
|---|---|
| Schema/Data Dictionary | ✅ 마이그레이션 001~025로 사실상 완료 |
| SourceAsset/SourceRow 처리 흐름 | ✅ 업로드→원천추적 파이프라인 구현 |
| Text-to-SQL Guardrail | ⬜ 미착수 (질의 계층 없음) |
| Finance Truth 5건 테스트 설계 | ⬜ 테스트셋 미정의 |
| Lineage Result Table Mock | 🟡 개별 화면 존재, 통합 결과표 미구현 |
| P0 Security Review | 🟡 단일 관리자 + RLS 기본, RBAC 미비 |
| Technical Spec v0.2 | 🟡 `target-data-lineage.md` + 본 문서 |

---

## 12. 미구현 갭 & 다음 작업 (권고)

REQ 대비 명확한 갭을 우선순위로 정리.

1. **Finance Truth 5건 테스트셋 정의** — `FinanceTruthCase`/기준값 테이블 신설, 회귀검증 자동화. (§8)
2. **통합 결과표 UI** — Answer·Source·Formula·Validation·Exception·Log 한 화면. 데이터는 이미 존재. (§9)
3. **역할 기반 접근권한(RBAC)** — 단일 관리자 → 사용자·역할·법인별 행 격리(RLS). (§10)
4. **QueryLog/AccessLog** — 조회·접근 로그. 자연어 질의 도입 시 필수. (§4, §7)
5. **정상 행 원본 보존(`parsed_rows`)** — 현재 오류 행만 raw 보존. (§4)
6. **원본 파일 열람 API(signed URL)** — 결과표에서 원본 역추적 열람. (§10)
7. **(선택) Text-to-SQL 질의 계층** — 도입 시 §7 가드레일 표가 곧 P0 체크리스트.

---

## 13. P0 리스크 — 현행 대비

| 리스크 | REQ 방어선 | 현행 상태 |
|---|---|---|
| 실재무자료 유출 | 샘플/비식별 우선, 외부 AI 금지 | ✅ AI 미사용으로 외부 전송 벡터 없음 · 🟡 접근제어는 단일 계정 |
| 원본성 훼손 | 원본 불변, Canonical 분리 | ✅ 구현됨 (덮어쓰기 방지 + 계층 분리) |
| AI 오답 신뢰 | No Source, No Answer | ✅ AI 없음 · 🟡 결과표 근거 통합 노출은 부분 |
| 권한 과조회 | 제한 View·RBAC·QueryLog | ⬜ 단일 관리자 · RBAC/제한View/QueryLog 미비 · RLS 정책은 `company_id` 조건 없이 휴면(§10) |
| 스키마 과설계 | Finance Truth 5건 중심 축소 | ⚠️ 25개 마이그레이션으로 이미 광범위(ERP 방향) — 테스트셋 부재와 대비되는 역방향 리스크 |
| 업무 혼선 | Founder Brief 승인 후 전환 | N/A |

---

## 14. 종합 판단

- **강점(REQ 충족):** 원본성·계보성 골격(Layer 1~2, 4)이 DB로 견고하게 구현됨.
  원본 불변·중복 비은폐·사람 검토 강제 원칙이 코드로 강제됨.
- **핵심 갭:** ① Finance Truth 테스트셋 ② 통합 결과표 UX ③ 역할 기반 접근권한 ④ 질의/접근 로그.
- **방향 코멘트:** 현행은 REQ가 경계한 "스키마 과설계"에 가까울 만큼 백엔드가 앞서 있는 반면,
  **검증 테스트셋과 사용자 대면 결과표·권한**이 뒤처져 있다. 다음 스프린트는 신규 테이블보다
  **검증(§8)·결과표(§9)·권한(§10)** 세 축에 집중하는 것이 REQ 정신에 부합한다.

_문서 끝 — AS-IS-FEEDAX Source Lineage 현행 정리 v0.1 / 2026-07-01 / SECRET_
