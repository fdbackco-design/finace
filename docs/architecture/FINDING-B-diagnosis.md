# FINDING-B 진단 — 매칭 자동확정(AUTO_CONFIRMED) 죽은 코드 검증

> **진단 전용 문서 (코드 변경 없음, read-only).** 기준일 2026-07-01.
> 대상: `src/lib/phase2/proposeAllocations.ts`, 마이그레이션 `014`·`022`.
> 결론 요약: **자동확정(AUTO_CONFIRMED)은 현재 프로덕션 경로에서 단 한 번도 발화하지 않는다.**
> 근본 원인은 `cash_event` 측 거래처(counterparty)가 조회 대상에 없어 `VENDOR_STRONG_MATCH`가 항상 실패하는 것.

---

## 1. 자동확정 판정 구조 & 9개 조건 (code) 라인별

**판정 형태:** `checks.every(...)` 맞음.
- `proposeAllocations.ts:117` — `const checks = runAutoConfirmChecks(ce, obl, companyCode);`
- `proposeAllocations.ts:118` — `const allPassed = checks.every(c => c.passed);`
- `proposeAllocations.ts:143` — `allocation_status: allPassed ? 'AUTO_CONFIRMED' : 'PROPOSED',` ← **유일한 자동확정 분기**

`runAutoConfirmChecks` (`proposeAllocations.ts:233`–`254`)의 9개 push:

| # | code | 라인 | 판정식 | 실제 판정? |
|---|---|---|---|---|
| 1 | SAME_COMPANY | `:243` | `passed: true` | ❌ 하드코딩 true (쿼리 `:70`·`:83`이 `company_id`로 이미 필터) |
| 2 | DIRECTION_MATCH | `:244` | `hasDirectionMatch(ce.event_type, obl.obligation_type)` | ✅ 실판정 |
| 3 | AMOUNT_EXACT | `:245` | `amountDiff <= 10` (`amountDiff`=`:241`) | ✅ 실판정 |
| 4 | DATE_WITHIN_3D | `:246` | `dateDiff <= 3` (`dateDiff`=`:240`) | ✅ 실판정 |
| 5 | VENDOR_STRONG_MATCH | `:247` | `vendorMatch({counterparty_name: ce.counterparty_name}, obl) >= 0.8` | ⚠️ 판정식 존재하나 **항상 false** (§2) |
| 6 | SINGLE_CANDIDATE | `:248` | `passed: true` | ❌ 하드코딩 true (§4) |
| 7 | SINGLE_ALLOCATION | `:249` | `passed: true` | ❌ 하드코딩 true (§4) |
| 8 | NOT_PARTIAL_PAYMENT | `:250` | `amountDiff <= 10` | 🟡 실판정이나 조건 3과 **동일 식** (중복, 독립 변별력 없음) |
| 9 | NO_PARSE_WARNINGS | `:251` | `passed: true` | ❌ 하드코딩 true (파싱 경고 연동 없음) |

→ 실제 변별력 있는 조건은 **2·3·4·5뿐**(8은 3과 동치). 그중 5가 항상 false이므로 `allPassed`는 5에 의해 결정된다.

---

## 2. VENDOR_STRONG_MATCH / vendorMatch — 항상 0.5로 떨어지는 이유

**vendorMatch 계산 위치:** `proposeAllocations.ts:262`–`278`.
- `:269` — `if (!ce.counterparty_name || !obl.counterparty_name) return 0.5; // 거래처 정보 없음`
- 즉 한쪽이라도 거래처명이 없으면 **기본값 0.5** 반환. (완전일치 1.0 `:274`, 포함 0.85 `:275`, bigram `:277`)

**호출부:** `:247` — `vendorMatch({ counterparty_name: (ce as unknown as {...}).counterparty_name }, obl)`

**ce(cash_event) 측 거래처가 로딩되지 않음 — 근거 2중:**

| 근거 | 라인 | 내용 |
|---|---|---|
| cash_event 조회 select에 counterparty 없음 | `proposeAllocations.ts:68`–`69` | `.from('v_cash_event_balance').select('id, event_type, event_date, gross_amount, unallocated_amount, cash_status')` — **counterparty_name 미포함** |
| ce 루프 타입에도 없음 | `:105`–`108` | ce 원소 타입: `id, event_type, event_date, gross_amount, unallocated_amount` |
| obl 측은 정상 로딩 | `:82` | obligations select에는 `counterparty_name, counterparty_business_no` 포함 (한쪽만 정상) |

→ 런타임에서 `ce.counterparty_name`은 항상 `undefined` → `:269`의 `!ce.counterparty_name`이 true → **vendorMatch는 항상 0.5** → `:247`의 `0.5 >= 0.8`은 **false** → `VENDOR_STRONG_MATCH.passed = false`.

---

## 3. cash_events 스키마 & v_cash_event_balance 뷰에 counterparty_name 존재 여부

| 대상 | 파일:라인 | counterparty_name 포함? |
|---|---|---|
| `cash_events` 테이블 정의 | `supabase/migrations/014_cash_events.sql:14`–`38` | ❌ **컬럼 자체가 없음** (컬럼: id, company_id/code, normalized_transaction_id, bank_transaction_id, event_type, event_date, gross_amount, account_no, source_type) |
| `v_cash_event_balance` 뷰 정의 | `supabase/migrations/022_phase2_views.sql:72`–`103` | ❌ `SELECT ce.*`(`:74`) + 계산 컬럼(confirmed_allocated_amount, unallocated_amount, cash_status)만. `ce.*`는 cash_events 컬럼이므로 counterparty 없음 |

→ **설령 `:69`의 select에 counterparty_name을 추가해도 뷰/테이블에 컬럼이 없어 가져올 수 없음.** 거래처는 `normalized_transactions`(013)에만 존재하므로, 근본 수정은 뷰 또는 조회 시 NT 조인이 필요.

---

## 4. SINGLE_CANDIDATE / SINGLE_ALLOCATION (6·7번) — 실제 검사 여부

| code | 라인 | 코드 | 후보수/배분수 검사? |
|---|---|---|---|
| SINGLE_CANDIDATE | `:248` | `{ code: 'SINGLE_CANDIDATE', passed: true }` // 주석: "DB 조회 후 post-filter에서 재확인" | ❌ 하드코딩 true |
| SINGLE_ALLOCATION | `:249` | `{ code: 'SINGLE_ALLOCATION', passed: true }` // "위와 동일" | ❌ 하드코딩 true |

**주석이 언급한 post-filter는 존재하지 않음.** `runAutoConfirmChecks` 반환(`:117`) 이후 코드는
`allPassed`(`:118`) → 방향체크(`:121`) → dateDiff(`:123`) → allocAmount(`:127`) → confidence(`:130`) →
row 빌드(`:133`–`145`) → push(`:147`)로 이어질 뿐, **동일 obligation을 가리키는 후보 수나 동일 cash_event의
배분 수를 재검사하는 로직이 없음.** DB 유니크 인덱스 `idx_ma_active_unique`(`017:66`–`68`)는 동일
`(cash_event, obligation)` **쌍** 중복만 막고 "1 입금 → N 의무 동시 확정"은 막지 못함.

---

## 5. 부가 확인 — 다른 AUTO_CONFIRMED 발화 경로 / 테스트 커버리지

- **런타임에서 `AUTO_CONFIRMED`를 쓰는 유일한 코드 경로는 `proposeAllocations.ts:143`.**
  RPC `process_review_decision`(`025`)는 PROPOSED→HUMAN_CONFIRMED/REJECTED/SUPERSEDED 전이만 하며
  AUTO_CONFIRMED를 **생성하지 않음**(`025:135`–`172`). 그 외 AUTO_CONFIRMED 문자열은 뷰/인덱스 필터
  (`022:57,101`, `023:40,45`)와 테스트 픽스처(`tests/phase2/golden-dataset.fixtures.ts:266`)뿐.
- **유닛 테스트는 이 버그를 잡지 못함.** `tests/phase2/proposeAllocations.unit.test.ts`는
  `hasDirectionMatch`/금액차/날짜차를 **산술 단위로만** 검증하고(`:29`,`:46`,`:81`),
  통합 `runAutoConfirmChecks` 경로나 `VENDOR_STRONG_MATCH`/ce 거래처 로딩은 테스트하지 않음.

---

## 최종 결론

### ❓ 자동확정이 실제로 한 번이라도 발화하는 경로가 있는가?

## **아니오 (NO).**

**근거 체인:**
1. 자동확정의 유일한 분기는 `proposeAllocations.ts:143` — `allPassed`가 true여야 함.
2. `allPassed = checks.every(c => c.passed)` (`:118`) → 9개 중 하나라도 false면 실패.
3. `VENDOR_STRONG_MATCH`(`:247`)는 `vendorMatch(ce, obl) >= 0.8`을 요구.
4. `ce.counterparty_name`은 조회(`:68`–`69`)·테이블(`014:14`–`38`)·뷰(`022:72`–`103`) 어디에도 없어 런타임 `undefined`.
5. 따라서 vendorMatch는 항상 `0.5` 반환(`:269`) → `VENDOR_STRONG_MATCH.passed = false`.
6. ⇒ `checks.every`는 **항상 false** ⇒ `:143`은 **항상 `'PROPOSED'`** 선택.
7. 다른 AUTO_CONFIRMED 생성 경로 없음(§5).

**부수 효과:** allocation 행 자체는 생성됨(신뢰도 하한 0.3 게이트 `:131`은 거래처 없이도 통과 가능,
max≈0.90) — 다만 전부 `PROPOSED` 상태 + `review_queue` 등록(`:196`–`226`)으로 사람 검토로 넘어감.
즉 "자동" 매칭이 없고 모든 배분이 수동 검토 대기로 쌓인다.

**근본 수정 방향(참고, 본 진단 범위 밖):** (a) cash_event 조회/뷰에 NT 거래처 조인해 `counterparty_name` 공급,
(b) 6·7번 post-filter(후보/배분 유일성) 실제 구현, (c) 통합 자동확정 경로 회귀 테스트 추가.

_문서 끝 — FINDING-B 진단 / read-only / 2026-07-01_

