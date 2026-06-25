# 매칭 규칙 원장

## 엔진 실행 순서

```
step1   가수금     (feedback 전용: 은행 입금 + 설명에 '송해민')
step3   HT 매입    (매입세금계산서·면세계산서 vs 은행 출금, ±60일)
step4   HT 매출    (매출세금계산서 vs 은행 입금)
step2   고정비     (FixedCostEntry 목록 vs 은행 출금)
salary  급여       (설명/메모에 '급여' 포함 은행 출금 → AUTO_MATCHED)
step5   잔여       (미매칭 카드 거래 → UNMATCHED cashflow)
```

## AUTO_MATCHED 조건 (step3/step4)

```
score = 0.5 + dateScore + vendorScore * 0.1

vendorHit = reason.includes('거래처유사') && !reason.includes('거래처미확인')
dupScores = candidates where score >= top.score - 0.05
allTied   = all dupScores within 0.001 of top.score  ← N:1 동일스코어 처리
isAuto    = score >= 0.75 && vendorHit && (dupScores.length === 1 || allTied)
```

**allTied 주의**: 현재 `allTied` 로직은 실제 N:N 배분이 아님 — 동일 스코어 후보들을 1:1로 순차 소비(sequential consumption). 진정한 N:N 금액 배분은 Phase 5에서 구현.

## transaction_matches 기록 대상 (Phase 1)

| match_type | ht_id | bank_id | card_id | fixed_cost_id | step |
|------------|-------|---------|---------|---------------|------|
| HT_PURCHASE-BANK | O | O | X | X | Step3 |
| HT_PURCHASE-CARD | O | X | O | X | Step3 |
| HT_SALES-BANK | O | O | X | X | Step4 |
| FIXED_COST-BANK | X | O | X | O | Step2 |

**기록 안 하는 step**: Step1(가수금), stepSalary(급여), Step5(잔여)

## 카드 결제일 계산 (CARD_SETTLEMENT_CONFIG)

설정 키: `"{company_code}:{source_type}"` (예: `"feedback:CARD_WOORI"`)

- `paymentDay`: 결제일 (1–31)
- `fromDay`: 이용기간 시작일
- `toDay`: 이용기간 종료일

사용일이 `fromDay–toDay` 사이면 당월 `paymentDay`에 결제, 아니면 익월로 계산.

## 고정비 규칙 (FixedCostEntry)

DB 테이블 `fixed_cost_rules`에서 로드. 컬럼:

| 컬럼 | 설명 |
|------|------|
| `payment_day` | 결제일 (1–31, 31=말일) |
| `vendor_name` | 자금수지현황표 거래처명 |
| `amount` | 기준금액 (0이면 변동) |
| `match_key` | 쉼표 구분 매핑 키 |
| `company_code` | 법인 코드 또는 'all' |
| `payment_type` | 계좌_송금/카드_자동결제/계좌_자동이체 |

## SUPERSEDED 처리 범위

재매칭 실행 시 이전 `matching_runs`의 `transaction_matches`를 비활성화:

```sql
UPDATE transaction_matches
SET is_active = false, match_status = 'SUPERSEDED'
WHERE is_active = true
  AND company_id = :company_id
  AND matching_run_id IN (
    SELECT id FROM matching_runs
    WHERE company_id = :company_id AND target_month = :month
      AND id != :current_run_id
  );
```

다른 법인 또는 다른 월의 매칭 이력은 영향받지 않음.

## 등록 거래처 기반 AUTO_MATCHED 승격

runRematch의 vendor 승격 패스:
- 조건: `match_status = 'MANUAL_REVIEW'` + `hometaxInvoiceId` + `bankTransactionId` + `matchReason.includes('금액일치')`
- 승격 기준: 거래처명 포함 일치 또는 사업자등록번호 일치
- 결과: `match_status → 'AUTO_MATCHED'`, `amountStatus` 업데이트
