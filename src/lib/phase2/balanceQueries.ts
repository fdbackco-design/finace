/**
 * Phase 2A: 잔액 뷰 조회
 *
 * v_obligation_balance / v_cash_event_balance 뷰 기반 조회.
 * 잔액(remaining_amount, unallocated_amount)은 이 파일을 통해서만 접근.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ObligationBalance, CashEventBalance, LifecycleStatus, CashStatus } from './types';

// ── Obligation 잔액 ────────────────────────────────────────────────────────────

export interface ObligationFilter {
  companyId?:       string;
  lifecycleStatus?: LifecycleStatus | LifecycleStatus[];
  dueDateFrom?:     string;
  dueDateTo?:       string;
  obligationIds?:   string[];
  limit?:           number;
}

export async function getObligationBalances(
  supabase: SupabaseClient,
  filter:   ObligationFilter,
): Promise<{ data: ObligationBalance[]; error: string | null }> {
  let q = supabase.from('v_obligation_balance').select('*');

  if (filter.companyId)     q = q.eq('company_id', filter.companyId);
  if (filter.obligationIds) q = q.in('id', filter.obligationIds);
  if (filter.dueDateFrom)   q = q.gte('due_date', filter.dueDateFrom);
  if (filter.dueDateTo)     q = q.lte('due_date', filter.dueDateTo);

  if (filter.lifecycleStatus) {
    const statuses = Array.isArray(filter.lifecycleStatus)
      ? filter.lifecycleStatus
      : [filter.lifecycleStatus];
    q = q.in('lifecycle_status', statuses);
  }

  if (filter.limit) q = q.limit(filter.limit);

  const { data, error } = await q;
  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as ObligationBalance[], error: null };
}

export async function getObligationBalance(
  supabase:      SupabaseClient,
  obligationId:  string,
): Promise<{ data: ObligationBalance | null; error: string | null }> {
  const { data, error } = await supabase
    .from('v_obligation_balance')
    .select('*')
    .eq('id', obligationId)
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as ObligationBalance, error: null };
}

// ── Cash Event 잔액 ───────────────────────────────────────────────────────────

export interface CashEventFilter {
  companyId?:    string;
  cashStatus?:   CashStatus | CashStatus[];
  eventDateFrom?: string;
  eventDateTo?:   string;
  cashEventIds?:  string[];
  limit?:         number;
}

export async function getCashEventBalances(
  supabase: SupabaseClient,
  filter:   CashEventFilter,
): Promise<{ data: CashEventBalance[]; error: string | null }> {
  let q = supabase.from('v_cash_event_balance').select('*');

  if (filter.companyId)    q = q.eq('company_id', filter.companyId);
  if (filter.cashEventIds) q = q.in('id', filter.cashEventIds);
  if (filter.eventDateFrom) q = q.gte('event_date', filter.eventDateFrom);
  if (filter.eventDateTo)   q = q.lte('event_date', filter.eventDateTo);

  if (filter.cashStatus) {
    const statuses = Array.isArray(filter.cashStatus)
      ? filter.cashStatus
      : [filter.cashStatus];
    q = q.in('cash_status', statuses);
  }

  if (filter.limit) q = q.limit(filter.limit);

  const { data, error } = await q;
  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as CashEventBalance[], error: null };
}

// ── 요약 통계 ──────────────────────────────────────────────────────────────────

export interface BalanceSummary {
  totalOpenObligations:     number;
  totalOpenRemainingAmount: number;
  totalUnallocatedCash:     number;
  overdueCount:             number;
}

export async function getBalanceSummary(
  supabase:  SupabaseClient,
  companyId: string,
  asOfDate:  string,
): Promise<{ data: BalanceSummary | null; error: string | null }> {
  const [oblRes, ceRes] = await Promise.all([
    supabase
      .from('v_obligation_balance')
      .select('remaining_amount, due_date')
      .eq('company_id', companyId)
      .in('lifecycle_status', ['OPEN', 'PARTIALLY_SETTLED']),
    supabase
      .from('v_cash_event_balance')
      .select('unallocated_amount')
      .eq('company_id', companyId)
      .in('cash_status', ['UNALLOCATED', 'PARTIALLY_ALLOCATED']),
  ]);

  if (oblRes.error) return { data: null, error: oblRes.error.message };
  if (ceRes.error)  return { data: null, error: ceRes.error.message };

  const obls = (oblRes.data ?? []) as { remaining_amount: number; due_date: string | null }[];
  const ces  = (ceRes.data  ?? []) as { unallocated_amount: number }[];

  const summary: BalanceSummary = {
    totalOpenObligations:     obls.length,
    totalOpenRemainingAmount: obls.reduce((s, o) => s + o.remaining_amount, 0),
    totalUnallocatedCash:     ces.reduce((s, c) => s + c.unallocated_amount, 0),
    overdueCount:             obls.filter(o => o.due_date != null && o.due_date < asOfDate).length,
  };

  return { data: summary, error: null };
}
