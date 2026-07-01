/**
 * Phase 2A: 연체 의무 감지
 *
 * due_date < today이고 lifecycle_status가 OPEN 또는 PARTIALLY_SETTLED인
 * obligation을 찾아 review_queue에 OVERDUE_OBLIGATION으로 등록.
 *
 * 호출 시점: upload 완료 직후 (backfill + allocation 제안 후)
 * Phase 2B에서 Vercel Cron으로 일별 자동 실행 예정.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyCode } from '../types';

export interface DetectOverdueOptions {
  companyId:   string;
  companyCode: CompanyCode;
  /** 기준 날짜 (기본값: 오늘) */
  asOfDate?:   string;
}

export interface DetectOverdueResult {
  newOverdue:  number;
  errors:      string[];
}

export async function detectOverdueObligations(
  supabase: SupabaseClient,
  opts:     DetectOverdueOptions,
): Promise<DetectOverdueResult> {
  const { companyId, companyCode, asOfDate } = opts;
  const today = asOfDate ?? new Date().toISOString().slice(0, 10);
  const result: DetectOverdueResult = { newOverdue: 0, errors: [] };

  // 연체 의무 조회
  const { data: overdueObls, error: oblErr } = await supabase
    .from('v_obligation_balance')
    .select('id, due_date, gross_amount, remaining_amount, counterparty_name, lifecycle_status')
    .eq('company_id', companyId)
    .in('lifecycle_status', ['OPEN', 'PARTIALLY_SETTLED'])
    .not('due_date', 'is', null)
    .lt('due_date', today);

  if (oblErr) {
    result.errors.push(`overdue query: ${oblErr.message}`);
    return result;
  }
  if (!overdueObls || overdueObls.length === 0) return result;

  // 이미 PENDING review_queue에 OVERDUE_OBLIGATION으로 등록된 것 제외
  const oblIds = overdueObls.map((o: { id: string }) => o.id);
  const { data: existing } = await supabase
    .from('review_queue')
    .select('obligation_id')
    .eq('company_id', companyId)
    .eq('review_type', 'OVERDUE_OBLIGATION')
    .in('case_status', ['PENDING', 'IN_REVIEW'])
    .in('obligation_id', oblIds);

  const existingSet = new Set(
    (existing ?? []).map((r: { obligation_id: string }) => r.obligation_id)
  );

  const newOverdue = overdueObls.filter((o: { id: string }) => !existingSet.has(o.id));
  if (newOverdue.length === 0) return result;

  const rqRows = newOverdue.map((o: {
    id: string;
    due_date: string;
    gross_amount: number;
    remaining_amount: number;
    counterparty_name: string | null;
    lifecycle_status: string;
  }) => {
    const daysOverdue = Math.floor(
      (new Date(today).getTime() - new Date(o.due_date).getTime()) / 86400000
    );
    return {
      company_id:    companyId,
      company_code:  companyCode,
      review_type:   'OVERDUE_OBLIGATION',
      priority:      daysOverdue > 30 ? 'URGENT' : 'NORMAL',
      case_status:   'PENDING',
      obligation_id: o.id,
      summary:       `연체 ${daysOverdue}일: ${o.counterparty_name ?? '거래처 미상'} ₩${o.remaining_amount.toLocaleString()}`,
      detail_json:   {
        due_date:        o.due_date,
        days_overdue:    daysOverdue,
        remaining_amount: o.remaining_amount,
        gross_amount:    o.gross_amount,
        lifecycle_status: o.lifecycle_status,
      },
    };
  });

  const { error: rqErr } = await supabase.from('review_queue').insert(rqRows);
  if (rqErr) {
    result.errors.push(`overdue review_queue insert: ${rqErr.message}`);
    return result;
  }

  result.newOverdue = rqRows.length;
  return result;
}
