# TEST-FEEDAX · Finance Truth 5 Cases Mapping v0.1

> REQ-FEEDAX v0.2 요청 산출물 중 **검증 테스트셋 매핑**. 담당: 최승희 + 이명진.
> 정본: `TECH-FEEDAX__Source_Lineage__AS-IS_현행정리__v0.1.md` §8.
> **현황: 시스템에 명시적 테스트셋/기준값 테이블(`FinanceTruthCase`)이 없음(⬜).**
> 본 문서는 5건 케이스를 현행 기능·상태값에 매핑하고, 최승희 과장에게 요청할 기준 데이터 필드를 정의한다.
> 보안등급 SECRET (실데이터 연결 시 RESTRICTED). 기준일 2026-07-01.

---

## 1. 케이스 ↔ 현행 기능 매핑 + 기대 상태값

| Case | 검증 포인트 | 현행 대응 기능 | 기대 결과(자동) | 상태 |
|---|---|---|---|---|
| **FT-001** 정상 매출/정산 | 기간·거래처합계·원본금액 일치 | `proposeAllocations` (금액≤10원, 날짜≤3일, 방향일치) | `allocation_status=AUTO_CONFIRMED`, `match_type=FULL`, obligation `lifecycle=SETTLED` | 🟡 발화불가(§발견 B) |
| **FT-002** 광고/마케팅 비용 | 카테고리 분류·증빙 연결 | `autoClassify` → `display_category`, HT↔은행 매칭 | `classification_basis` 기록, `display_category='광고비'` | 🟡 |
| **FT-003** 수수료/외주/인건비 | 계정성격 분류 | `match_type=FEE_ADJUSTED`, `stepSalary`(급여 그룹) | 수수료 차감 시 `obligation_adjustments`+`review_queue(FEE_DEDUCTION)` | 🟡 |
| **FT-004** 환불/차감/보정 | 음수·보정·차감 로직 | `obligation_adjustments`(WRITE_OFF, CEO 승인) | `status=HUMAN_CONFIRMED`, 잔액 View 반영 | 🟡 |
| **FT-005** 중복/누락/증빙불일치 | 예외 탐지·검토 플래그 | `source_hash` dedup, `DUPLICATE_SOURCE`, `detectOverdue`, `review_queue` | `OVERDUE_OBLIGATION`/중복 링크 생성 | ✅ |

**검증 상태값(현행 실제 enum, REQ의 MATCH/MISMATCH/… 대체):**
`allocation_status` PROPOSED·AUTO_CONFIRMED·HUMAN_CONFIRMED·REJECTED·SUPERSEDED /
`lifecycle_status` OPEN·PARTIALLY_SETTLED·SETTLED·CANCELLED·SUPERSEDED /
`cash_status` UNALLOCATED·PARTIALLY_ALLOCATED·FULLY_ALLOCATED·OVER_ALLOCATED

---

## 2. 최승희 과장에게 요청할 기준 데이터 (케이스당)

각 FT 케이스별로 실제 5건 원본을 아래 필드로 확정 요청:

| 필드 | 설명 | 예시 |
|---|---|---|
| case_id | FT-001~005 | FT-002 |
| company_code | feedback/sangsaeng/shootmoon | feedback |
| source_file | 원본 파일명·시트·행번호 | 우리은행_2026-06.xlsx / Sheet1 / 42 |
| period | 대상 기간 | 2026-06 |
| counterparty | 거래처명 + 사업자번호 | (주)구글코리아 / 120-81-xxxxx |
| expected_metric | 검증 지표 | 광고비 총액 |
| expected_value | 기준 정답값(원) | 12,340,000 |
| expected_status | 기대 검증 상태 | AUTO_CONFIRMED / SETTLED |
| exception_expected | 예상 예외(FT-005 등) | DUPLICATE_SUSPECT |
| note | 비고 | 부가세 포함 여부 등 |

---

## 3. 필요한 신규 구현 (검증 자동화)

1. **`finance_truth_cases` 테이블 신설** — 위 필드 스키마. append-only 기준값.
2. **`finance_truth_results` (대조 결과)** — `expected_value` vs `actual_value`, `delta`, `status(MATCH/MISMATCH/NEEDS_REVIEW/MISSING_EVIDENCE/DUPLICATE_SUSPECT)`, `reviewed_by/at`.
3. **회귀 검증 러너** — 업로드/재매칭 후 5건 재대조, delta≠0 시 리포트. (현재 `npm` 스크립트로 시작 가능, `tests/` 활용)
4. **선결 과제:** FT-001 자동확정이 발화하려면 정본 §8 **발견 B**(cash_event 거래처 미로딩) 수정 필요.

## 4. 성공 기준 (REQ 인용)
> 같은 질문에 같은 원본·같은 계산식·같은 검증상태가 재현됨.

→ 본 테스트셋이 회귀 러너로 매 업로드 후 5건을 재대조해 delta=0을 유지하면 충족.

_문서 끝 — TEST-FEEDAX Finance Truth 5 Cases Mapping v0.1 / SECRET_
