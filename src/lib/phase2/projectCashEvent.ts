/**
 * Phase 2A: Cash Event 투영
 *
 * REALIZED_INFLOW / REALIZED_OUTFLOW NT(은행 거래 연결)를
 * cash_events 테이블에 반영한다.
 * 카드/홈택스 NT는 cash_event 대상이 아님.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyCode } from '../types';

export interface ProjectCashEventOptions {
  companyId:    string;
  companyCode:  CompanyCode;
  /** 특정 NT ID 목록만 처리 (null이면 미처리 REALIZED 전체) */
  ntIds?: string[];
}

export interface ProjectCashEventResult {
  created: number;
  errors:  string[];
}

export async function projectCashEvents(
  supabase: SupabaseClient,
  opts:     ProjectCashEventOptions,
): Promise<ProjectCashEventResult> {
  const { companyId, companyCode, ntIds } = opts;
  const result: ProjectCashEventResult = { created: 0, errors: [] };

  // REALIZED_* NT 중 아직 cash_event 없는 것 조회
  let q = supabase
    .from('normalized_transactions')
    .select(`
      id,
      bank_transaction_id,
      event_type,
      event_date,
      gross_amount,
      bank_transactions ( account_no, source_type )
    `)
    .eq('company_id', companyId)
    .in('event_type', ['REALIZED_INFLOW', 'REALIZED_OUTFLOW']);

  if (ntIds) {
    q = q.in('id', ntIds);
  } else {
    const { data: existing } = await supabase
      .from('cash_events')
      .select('normalized_transaction_id')
      .eq('company_id', companyId);
    const existingNtIds = (existing ?? []).map((r: { normalized_transaction_id: string }) => r.normalized_transaction_id);
    if (existingNtIds.length > 0) q = q.not('id', 'in', `(${existingNtIds.join(',')})`);
  }

  const { data: nts, error: qErr } = await q;
  if (qErr) {
    result.errors.push(`cash_event NT query: ${qErr.message}`);
    return result;
  }
  if (!nts || nts.length === 0) return result;

  // Supabase join returns related row as an array (even for 1:1 FK)
  type BankTxJoin = { account_no: string | null; source_type: string | null };
  const ceRows = nts.map((nt: {
    id: string;
    bank_transaction_id: string;
    event_type: string;
    event_date: string;
    gross_amount: number;
    bank_transactions: BankTxJoin | BankTxJoin[] | null;
  }) => {
    const bt = Array.isArray(nt.bank_transactions) ? nt.bank_transactions[0] : nt.bank_transactions;
    return ({
    company_id:                companyId,
    company_code:              companyCode,
    normalized_transaction_id: nt.id,
    bank_transaction_id:       nt.bank_transaction_id,
    event_type:                nt.event_type === 'REALIZED_INFLOW' ? 'INFLOW' : 'OUTFLOW',
    event_date:                nt.event_date,
    gross_amount:              nt.gross_amount,
    account_no:                bt?.account_no ?? null,
    source_type:               bt?.source_type ?? null,
    });
  });

  const { error: insertErr, count } = await supabase
    .from('cash_events')
    .upsert(ceRows, { onConflict: 'normalized_transaction_id', ignoreDuplicates: true, count: 'exact' });

  if (insertErr) {
    result.errors.push(`cash_event upsert: ${insertErr.message}`);
  } else {
    result.created = count ?? ceRows.length;
  }

  return result;
}
