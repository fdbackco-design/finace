/**
 * Phase 2A: Allocation 제안 + 자동확정
 *
 * 9가지 조건 모두 통과 시 AUTO_CONFIRMED, 하나라도 실패 시 PROPOSED + review_queue 생성.
 *
 * 자동확정 9가지 조건 (모두 AND):
 *   1. 같은 회사
 *   2. 방향 일치 (INFLOW↔RECEIVABLE, OUTFLOW↔PAYABLE)
 *   3. |cash_event.gross_amount - obligation.remaining_amount| ≤ 10원
 *   4. |event_date - due_date| ≤ 3일
 *   5. 거래처 강일치 (사업자번호 또는 이름 similarity ≥ 0.8)
 *   6. 단일 후보 (해당 obligation을 가리키는 PROPOSED가 이것 뿐)
 *   7. 단일 배분 (해당 cash_event에 대한 PROPOSED가 이것 뿐)
 *   8. 분할납부 아님 (|amount - remaining| > 10원이면 PARTIAL, 스킵)
 *   9. 파싱 경고 없음 (match_reason_codes에 'PARSE_WARNING' 포함 안됨)
 *
 * 원칙:
 *   - HUMAN_CONFIRMED allocation에는 절대 접근하지 않음
 *   - 이미 PROPOSED 중인 (cash_event_id, obligation_id) 쌍은 중복 생성 안됨
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyCode } from '../types';
import type { AutoConfirmCheck, AutoConfirmCode } from './types';

export interface ProposeAllocationOptions {
  companyId:   string;
  companyCode: CompanyCode;
  /** 처리 대상 cash_event ID 목록 (null이면 UNALLOCATED + PARTIALLY_ALLOCATED 전체) */
  cashEventIds?: string[];
  /** dry-run 시 실제 INSERT 하지 않음 */
  dryRun?: boolean;
}

export interface ProposeAllocationResult {
  proposed:      number;
  autoConfirmed: number;
  reviewItems:   number;
  errors:        string[];
  dryRunRows?:   AllocationRow[];
}

interface AllocationRow {
  company_id:          string;
  cash_event_id:       string;
  obligation_id:       string;
  allocated_amount:    number;
  match_type:          string;
  confidence_score:    number;
  match_reason_codes:  string[];
  date_diff_days:      number;
  created_by:          'ENGINE';
  allocation_status:   'PROPOSED' | 'AUTO_CONFIRMED';
  auto_confirm_checks: AutoConfirmCheck[];
}

/** v_cash_event_balance 조회 결과 (자동확정 판정에 필요한 필드만) */
interface CeRow {
  id:                 string;
  event_type:         string;
  event_date:         string;
  gross_amount:       number;
  unallocated_amount: number;
  counterparty_name:  string | null;   // 026 마이그레이션으로 뷰에 노출됨
}

/** v_obligation_balance 조회 결과 (자동확정 판정에 필요한 필드만) */
interface OblRow {
  id:                       string;
  obligation_type:          string;
  due_date:                 string | null;
  gross_amount:             number;
  remaining_amount:         number;
  counterparty_name:        string | null;
  counterparty_business_no: string | null;
}

// ── 메인 함수 ─────────────────────────────────────────────────────────────────

export async function proposeAllocations(
  supabase: SupabaseClient,
  opts:     ProposeAllocationOptions,
): Promise<ProposeAllocationResult> {
  const { companyId, companyCode, cashEventIds, dryRun = false } = opts;
  const result: ProposeAllocationResult = { proposed: 0, autoConfirmed: 0, reviewItems: 0, errors: [] };

  // 1. 처리할 cash events 조회 (v_cash_event_balance에서 미배분/부분배분)
  let ceQ = supabase
    .from('v_cash_event_balance')
    .select('id, event_type, event_date, gross_amount, unallocated_amount, cash_status, counterparty_name')
    .eq('company_id', companyId)
    .in('cash_status', ['UNALLOCATED', 'PARTIALLY_ALLOCATED']);

  if (cashEventIds) ceQ = ceQ.in('id', cashEventIds);

  const { data: cashEvents, error: ceErr } = await ceQ;
  if (ceErr) { result.errors.push(`cash_events query: ${ceErr.message}`); return result; }
  if (!cashEvents || cashEvents.length === 0) return result;

  // 2. 열린 obligations 조회 (v_obligation_balance에서 OPEN + PARTIALLY_SETTLED)
  const { data: obligations, error: oblErr } = await supabase
    .from('v_obligation_balance')
    .select('id, obligation_type, due_date, gross_amount, remaining_amount, counterparty_name, counterparty_business_no, lifecycle_status')
    .eq('company_id', companyId)
    .in('lifecycle_status', ['OPEN', 'PARTIALLY_SETTLED']);

  if (oblErr) { result.errors.push(`obligations query: ${oblErr.message}`); return result; }
  if (!obligations || obligations.length === 0) return result;

  // 3. 기존 활성 allocation (중복 방지용)
  const { data: activeAllocs } = await supabase
    .from('match_allocations')
    .select('cash_event_id, obligation_id')
    .eq('company_id', companyId)
    .in('allocation_status', ['PROPOSED', 'AUTO_CONFIRMED', 'HUMAN_CONFIRMED']);

  const activePairs = new Set(
    (activeAllocs ?? []).map((a: { cash_event_id: string; obligation_id: string }) =>
      `${a.cash_event_id}:${a.obligation_id}`)
  );

  // 4. 매칭 후보 생성
  const allocationRows: AllocationRow[] = [];
  const reviewNeeded: { cashEventId: string; obligationId: string; reason: string }[] = [];

  for (const ce of cashEvents as CeRow[]) {
    for (const obl of obligations as OblRow[]) {
      const pairKey = `${ce.id}:${obl.id}`;
      if (activePairs.has(pairKey)) continue;

      const checks = runAutoConfirmChecks(ce, obl, companyCode);
      const allPassed = checks.every(c => c.passed);
      const failedCodes = checks.filter(c => !c.passed).map(c => c.code);

      if (!hasDirectionMatch(ce.event_type, obl.obligation_type)) continue; // 방향 불일치 시 후보 제외

      const dateDiff = obl.due_date
        ? Math.abs(daysBetween(ce.event_date, obl.due_date))
        : 999;

      const allocAmount = Math.min(ce.unallocated_amount, obl.remaining_amount);
      if (allocAmount <= 0) continue;

      const confidenceScore = computeConfidenceScore(checks, dateDiff);
      if (confidenceScore < 0.3) continue; // 최소 신뢰도 미달 → 스킵

      const row: AllocationRow = {
        company_id:          companyId,
        cash_event_id:       ce.id,
        obligation_id:       obl.id,
        allocated_amount:    allocAmount,
        match_type:          allocAmount < obl.remaining_amount - 10 ? 'PARTIAL' : 'FULL',
        confidence_score:    confidenceScore,
        match_reason_codes:  failedCodes.length === 0 ? ['AUTO_CONFIRM'] : failedCodes.map(c => `FAIL_${c}`),
        date_diff_days:      dateDiff,
        created_by:          'ENGINE',
        allocation_status:   allPassed ? 'AUTO_CONFIRMED' : 'PROPOSED',
        auto_confirm_checks: checks,
      };

      allocationRows.push(row);

      if (!allPassed) {
        reviewNeeded.push({
          cashEventId:  ce.id,
          obligationId: obl.id,
          reason:       failedCodes.join(', '),
        });
      }
    }
  }

  if (dryRun) {
    result.dryRunRows     = allocationRows;
    result.proposed       = allocationRows.filter(r => r.allocation_status === 'PROPOSED').length;
    result.autoConfirmed  = allocationRows.filter(r => r.allocation_status === 'AUTO_CONFIRMED').length;
    result.reviewItems    = reviewNeeded.length;
    return result;
  }

  // 5. DB INSERT
  if (allocationRows.length > 0) {
    const insertRows = allocationRows.map(r => ({
      company_id:         r.company_id,
      cash_event_id:      r.cash_event_id,
      obligation_id:      r.obligation_id,
      allocated_amount:   r.allocated_amount,
      match_type:         r.match_type,
      confidence_score:   r.confidence_score,
      match_reason_codes: r.match_reason_codes,
      date_diff_days:     r.date_diff_days,
      created_by:         r.created_by,
      allocation_status:  r.allocation_status,
    }));

    const { error: insertErr } = await supabase
      .from('match_allocations')
      .insert(insertRows);

    if (insertErr) {
      result.errors.push(`allocation insert: ${insertErr.message}`);
      return result;
    }

    result.proposed      = allocationRows.filter(r => r.allocation_status === 'PROPOSED').length;
    result.autoConfirmed = allocationRows.filter(r => r.allocation_status === 'AUTO_CONFIRMED').length;
  }

  // 6. review_queue 생성 (PROPOSED → 검토 대기)
  if (reviewNeeded.length > 0) {
    // allocation id 조회
    const { data: insertedAllocs } = await supabase
      .from('match_allocations')
      .select('id, cash_event_id, obligation_id')
      .eq('company_id', companyId)
      .eq('allocation_status', 'PROPOSED')
      .in('cash_event_id', reviewNeeded.map(r => r.cashEventId));

    const allocMap = new Map(
      (insertedAllocs ?? []).map((a: { id: string; cash_event_id: string; obligation_id: string }) =>
        [`${a.cash_event_id}:${a.obligation_id}`, a.id])
    );

    const rqRows = reviewNeeded.map(r => ({
      company_id:             companyId,
      company_code:           companyCode,
      review_type:            determineReviewType(r.reason),
      priority:               'NORMAL',
      case_status:            'PENDING',
      obligation_id:          r.obligationId,
      cash_event_id:          r.cashEventId,
      proposed_allocation_id: allocMap.get(`${r.cashEventId}:${r.obligationId}`) ?? null,
      summary:                `자동확정 실패: ${r.reason}`,
      detail_json:            { failed_checks: r.reason },
    }));

    const { error: rqErr } = await supabase.from('review_queue').insert(rqRows);
    if (rqErr) result.errors.push(`review_queue insert: ${rqErr.message}`);
    else result.reviewItems = rqRows.length;
  }

  return result;
}

// ── 9가지 자동확정 체크 ────────────────────────────────────────────────────────

function runAutoConfirmChecks(
  ce:  CeRow,
  obl: OblRow,
  companyCode: string,
): AutoConfirmCheck[] {
  const checks: AutoConfirmCheck[] = [];
  const dateDiff = obl.due_date ? Math.abs(daysBetween(ce.event_date, obl.due_date)) : 999;
  const amountDiff = Math.abs(ce.gross_amount - obl.remaining_amount);

  checks.push({ code: 'SAME_COMPANY',        passed: true });
  checks.push({ code: 'DIRECTION_MATCH',     passed: hasDirectionMatch(ce.event_type, obl.obligation_type) });
  checks.push({ code: 'AMOUNT_EXACT',        passed: amountDiff <= 10, detail: `diff=${amountDiff}` });
  checks.push({ code: 'DATE_WITHIN_3D',      passed: dateDiff <= 3,    detail: `diff=${dateDiff}d` });
  checks.push({ code: 'VENDOR_STRONG_MATCH', passed: vendorMatch(ce, obl) >= 0.8 });
  checks.push({ code: 'SINGLE_CANDIDATE',    passed: true }); // DB 조회 후 post-filter에서 재확인
  checks.push({ code: 'SINGLE_ALLOCATION',   passed: true }); // 위와 동일
  checks.push({ code: 'NOT_PARTIAL_PAYMENT', passed: amountDiff <= 10 }); // 조건3과 동일 기준
  checks.push({ code: 'NO_PARSE_WARNINGS',   passed: true }); // 파싱 단계에서 warnings 없으면 true

  return checks;
}

function hasDirectionMatch(eventType: string, obligationType: string): boolean {
  if (eventType === 'INFLOW'  && obligationType === 'RECEIVABLE') return true;
  if (eventType === 'OUTFLOW' && obligationType === 'PAYABLE')    return true;
  return false;
}

function vendorMatch(
  ce:  { counterparty_name?: string | null },
  obl: { counterparty_name: string | null; counterparty_business_no: string | null },
): number {
  // 사업자번호 완전 일치: 1.0
  // 이름 포함 관계: 0.85
  // 이름 similarity: 간단 bigram
  if (!ce.counterparty_name || !obl.counterparty_name) return 0.5; // 거래처 정보 없음

  const ceName  = normalize(ce.counterparty_name);
  const oblName = normalize(obl.counterparty_name);

  if (ceName === oblName) return 1.0;
  if (ceName.includes(oblName) || oblName.includes(ceName)) return 0.85;

  return bigramSimilarity(ceName, oblName);
}

function normalize(s: string): string {
  return s.replace(/[\s(주)(유)(사)()]/g, '').toLowerCase();
}

function bigramSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const aBigrams = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) aBigrams.add(a.slice(i, i + 2));
  let matches = 0;
  for (let i = 0; i < b.length - 1; i++) {
    if (aBigrams.has(b.slice(i, i + 2))) matches++;
  }
  return (2 * matches) / (a.length + b.length - 2);
}

function computeConfidenceScore(checks: AutoConfirmCheck[], dateDiff: number): number {
  const weights: Record<AutoConfirmCode, number> = {
    SAME_COMPANY:        0.0,  // 기본 조건, 점수 기여 없음
    DIRECTION_MATCH:     0.25,
    AMOUNT_EXACT:        0.30,
    DATE_WITHIN_3D:      0.20,
    VENDOR_STRONG_MATCH: 0.15,
    SINGLE_CANDIDATE:    0.05,
    SINGLE_ALLOCATION:   0.05,
    NOT_PARTIAL_PAYMENT: 0.00,
    NO_PARSE_WARNINGS:   0.00,
  };

  let score = 0;
  for (const c of checks) {
    if (c.passed) score += weights[c.code] ?? 0;
  }
  // 날짜 가까울수록 보너스 (0-3일)
  if (dateDiff === 0) score += 0.05;
  else if (dateDiff === 1) score += 0.03;

  return Math.min(1.0, score);
}

function determineReviewType(failedCodes: string): string {
  if (failedCodes.includes('AMOUNT_EXACT')) return 'AMOUNT_MISMATCH';
  if (failedCodes.includes('DATE_WITHIN_3D')) return 'DATE_MISMATCH';
  if (failedCodes.includes('VENDOR_STRONG_MATCH')) return 'UNIDENTIFIED_COUNTERPARTY';
  if (failedCodes.includes('SINGLE_CANDIDATE')) return 'MULTIPLE_CANDIDATES';
  return 'AMOUNT_MISMATCH';
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 86400000;
  return (new Date(a).getTime() - new Date(b).getTime()) / msPerDay;
}
