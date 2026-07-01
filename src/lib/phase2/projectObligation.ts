/**
 * Phase 2A: Obligation 투영
 *
 * 세 가지 소스에서 obligations를 생성:
 *   1. 홈택스 세금계산서 NT (HT_INVOICE — 1:1)
 *   2. 카드 거래 NT 그룹 ({company}||{source_type}||{payment_due_date} — N:1)
 *   3. 고정비 규칙 (FIXED_COST_RULE — 월별 1:1)
 *
 * 원칙:
 *   - 이미 존재하는 obligation은 ON CONFLICT DO NOTHING으로 스킵
 *   - is_user_locked=true인 obligation은 수정하지 않음
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyCode } from '../types';

export interface ProjectObligationOptions {
  companyId:   string;
  companyCode: CompanyCode;
  /** null이면 미처리 전체, 값이 있으면 해당 NT만 */
  htNtIds?:   string[];
  cardNtIds?: string[];
  /** 고정비 규칙 생성 대상 월 (YYYY-MM), 미지정 시 현재 월 */
  fixedCostMonth?: string;
}

export interface ProjectObligationResult {
  htObligations:        number;
  cardGroupObligations: number;
  fixedCostObligations: number;
  errors:               string[];
}

// ── 메인 함수 ──────────────────────────────────────────────────────────────────

export async function projectObligations(
  supabase: SupabaseClient,
  opts:     ProjectObligationOptions,
): Promise<ProjectObligationResult> {
  const { companyId, companyCode, htNtIds, cardNtIds, fixedCostMonth } = opts;
  const result: ProjectObligationResult = {
    htObligations: 0, cardGroupObligations: 0, fixedCostObligations: 0, errors: [],
  };

  const [htRes, cardRes, fcRes] = await Promise.allSettled([
    projectHtObligations(supabase, companyId, companyCode, htNtIds),
    projectCardGroupObligations(supabase, companyId, companyCode, cardNtIds),
    projectFixedCostObligations(supabase, companyId, companyCode, fixedCostMonth),
  ]);

  if (htRes.status   === 'fulfilled') { result.htObligations        = htRes.value.count;  result.errors.push(...htRes.value.errors);   }
  else                                { result.errors.push(`HT obligation: ${htRes.reason}`); }
  if (cardRes.status === 'fulfilled') { result.cardGroupObligations  = cardRes.value.count; result.errors.push(...cardRes.value.errors); }
  else                                { result.errors.push(`card group obligation: ${cardRes.reason}`); }
  if (fcRes.status   === 'fulfilled') { result.fixedCostObligations  = fcRes.value.count;  result.errors.push(...fcRes.value.errors);   }
  else                                { result.errors.push(`fixed cost obligation: ${fcRes.reason}`); }

  return result;
}

// ── 1. 홈택스 세금계산서 → obligation ─────────────────────────────────────────

async function projectHtObligations(
  supabase:    SupabaseClient,
  companyId:   string,
  companyCode: CompanyCode,
  htNtIds?:    string[],
): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];

  // HT NT 중 아직 obligation 없는 것 조회
  let q = supabase
    .from('normalized_transactions')
    .select(`
      id,
      hometax_invoice_id,
      event_type,
      event_date,
      gross_amount,
      counterparty_name,
      counterparty_business_no,
      hometax_invoices ( invoice_direction, issue_date )
    `)
    .eq('company_id', companyId)
    .not('hometax_invoice_id', 'is', null)
    .in('event_type', ['EXPECTED_INFLOW', 'EXPECTED_OUTFLOW']);

  if (htNtIds) {
    q = q.in('id', htNtIds);
  } else {
    const { data: existing } = await supabase
      .from('obligations')
      .select('normalized_transaction_id')
      .eq('company_id', companyId)
      .eq('origin_type', 'SOURCE_TRANSACTION')
      .not('normalized_transaction_id', 'is', null);
    const existingNtIds = (existing ?? []).map((r: { normalized_transaction_id: string }) => r.normalized_transaction_id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (existingNtIds.length > 0) q = (q as any).not('id', 'in', `(${existingNtIds.join(',')})`)
  }

  const { data: nts, error: qErr } = await q;
  if (qErr) return { count: 0, errors: [`HT NT query: ${qErr.message}`] };
  if (!nts || nts.length === 0) return { count: 0, errors: [] };

  type HtInvoiceJoin = { invoice_direction: 'sales' | 'purchase'; issue_date: string };
  const oblRows = (nts as unknown as Array<{
    id: string;
    hometax_invoice_id: string;
    event_type: string;
    event_date: string;
    gross_amount: number;
    counterparty_name: string | null;
    counterparty_business_no: string | null;
    hometax_invoices: HtInvoiceJoin | HtInvoiceJoin[] | null;
  }>).map((nt) => {
    const htRow = Array.isArray(nt.hometax_invoices) ? nt.hometax_invoices[0] : nt.hometax_invoices;
    const direction = htRow?.invoice_direction ?? 'purchase';
    return {
      company_id:                        companyId,
      company_code:                      companyCode,
      origin_type:                       'SOURCE_TRANSACTION',
      obligation_type:                   direction === 'sales' ? 'RECEIVABLE' : 'PAYABLE',
      obligation_subtype:                'HT_INVOICE',
      due_date:                          nt.event_date,
      gross_amount:                      nt.gross_amount,
      normalized_transaction_id:         nt.id,
      counterparty_name:                 nt.counterparty_name,
      counterparty_business_no:          nt.counterparty_business_no,
      is_user_locked:                    false,
      is_cancelled:                      false,
      is_superseded:                     false,
    };
  });

  const { error: insertErr, data: inserted } = await supabase
    .from('obligations')
    .upsert(oblRows, { onConflict: 'normalized_transaction_id', ignoreDuplicates: true })
    .select('id, normalized_transaction_id');

  if (insertErr) {
    errors.push(`HT obligation upsert: ${insertErr.message}`);
    return { count: 0, errors };
  }

  // obligation_source_links 생성 (HT_INVOICE_SOURCE)
  const insertedRows = (inserted ?? []) as { id: string; normalized_transaction_id: string }[];
  if (insertedRows.length > 0) {
    const ntMap = new Map(nts.map((n: { id: string; hometax_invoice_id: string; gross_amount: number }) =>
      [n.id, { hometax_invoice_id: n.hometax_invoice_id, gross_amount: n.gross_amount }]));
    const linkRows = insertedRows
      .filter(r => ntMap.has(r.normalized_transaction_id))
      .map(r => {
        const nt = ntMap.get(r.normalized_transaction_id)!;
        return {
          obligation_id:             r.id,
          link_type:                 'HT_INVOICE_SOURCE',
          normalized_transaction_id: r.normalized_transaction_id,
          hometax_invoice_id:        nt.hometax_invoice_id,
          contributing_amount:       nt.gross_amount,
        };
      });

    if (linkRows.length > 0) {
      const { error: linkErr } = await supabase
        .from('obligation_source_links')
        .upsert(linkRows, { onConflict: 'obligation_id,normalized_transaction_id', ignoreDuplicates: true });
      if (linkErr) errors.push(`HT source_link upsert: ${linkErr.message}`);
    }
  }

  return { count: insertedRows.length, errors };
}

// ── 2. 카드 거래 NT 그룹 → obligation ────────────────────────────────────────

async function projectCardGroupObligations(
  supabase:    SupabaseClient,
  companyId:   string,
  companyCode: CompanyCode,
  cardNtIds?:  string[],
): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];

  // 카드 NT 전체 조회 (payment_due_date 포함)
  let q = supabase
    .from('normalized_transactions')
    .select(`
      id,
      card_transaction_id,
      gross_amount,
      card_transactions ( source_type, payment_due_date )
    `)
    .eq('company_id', companyId)
    .not('card_transaction_id', 'is', null);

  if (cardNtIds) q = q.in('id', cardNtIds);

  const { data: nts, error: qErr } = await q;
  if (qErr) return { count: 0, errors: [`card NT query: ${qErr.message}`] };
  if (!nts || nts.length === 0) return { count: 0, errors: [] };

  // 그룹 키: {company_code}||{source_type}||{payment_due_date}
  type CardGroupEntry = {
    ntId:            string;
    cardTxId:        string;
    grossAmount:     number;
    sourceType:      string;
    paymentDueDate:  string;
    groupKey:        string;
  };

  type CardTxJoin = { source_type: string; payment_due_date: string };

  const entries: CardGroupEntry[] = [];
  for (const nt of nts as unknown as Array<{
    id: string;
    card_transaction_id: string;
    gross_amount: number;
    card_transactions: CardTxJoin | CardTxJoin[] | null;
  }>) {
    const ctRow  = Array.isArray(nt.card_transactions) ? nt.card_transactions[0] : nt.card_transactions;
    const sourceType     = ctRow?.source_type;
    const paymentDueDate = ctRow?.payment_due_date;
    if (!sourceType || !paymentDueDate) continue;

    entries.push({
      ntId:           nt.id,
      cardTxId:       nt.card_transaction_id,
      grossAmount:    nt.gross_amount,
      sourceType,
      paymentDueDate,
      groupKey:       `${companyCode}||${sourceType}||${paymentDueDate}`,
    });
  }

  if (entries.length === 0) return { count: 0, errors: [] };

  // 그룹별 집계
  const groups = new Map<string, { totalAmount: number; dueDate: string; sourceType: string; entries: CardGroupEntry[] }>();
  for (const e of entries) {
    const g = groups.get(e.groupKey);
    if (g) {
      g.totalAmount += e.grossAmount;
      g.entries.push(e);
    } else {
      groups.set(e.groupKey, { totalAmount: e.grossAmount, dueDate: e.paymentDueDate, sourceType: e.sourceType, entries: [e] });
    }
  }

  // 이미 존재하는 카드 그룹 obligation 확인
  const allGroupKeys = [...groups.keys()];
  const { data: existingObls } = await supabase
    .from('obligations')
    .select('id, card_settlement_group_key')
    .eq('company_id', companyId)
    .in('card_settlement_group_key', allGroupKeys);

  const existingGroupKeys = new Set(
    (existingObls ?? []).map((o: { card_settlement_group_key: string }) => o.card_settlement_group_key)
  );

  // 신규 그룹만 obligation 생성
  const newOblRows: {
    company_id: string;
    company_code: CompanyCode;
    origin_type: string;
    obligation_type: string;
    obligation_subtype: string;
    due_date: string;
    gross_amount: number;
    card_settlement_group_key: string;
    is_user_locked: boolean;
    is_cancelled: boolean;
    is_superseded: boolean;
  }[] = [];
  for (const [key, group] of groups) {
    if (!existingGroupKeys.has(key)) {
      newOblRows.push({
        company_id:                companyId,
        company_code:              companyCode,
        origin_type:               'CARD_SETTLEMENT_GROUP',
        obligation_type:           'PAYABLE',
        obligation_subtype:        'CARD_SETTLEMENT_GROUP',
        due_date:                  group.dueDate,
        gross_amount:              group.totalAmount,
        card_settlement_group_key: key,
        is_user_locked:            false,
        is_cancelled:              false,
        is_superseded:             false,
      });
    }
  }

  let newCount = 0;
  if (newOblRows.length > 0) {
    const { data: inserted, error: insertErr } = await supabase
      .from('obligations')
      .insert(newOblRows)
      .select('id, card_settlement_group_key');

    if (insertErr) {
      errors.push(`card group obligation insert: ${insertErr.message}`);
    } else {
      newCount = (inserted ?? []).length;

      // obligation_source_links (CARD_COMPONENT) 생성
      const insertedMap = new Map(
        (inserted as { id: string; card_settlement_group_key: string }[]).map(r => [r.card_settlement_group_key, r.id])
      );
      const linkRows = [];
      for (const [key, group] of groups) {
        const oblId = insertedMap.get(key);
        if (!oblId) continue;
        for (const e of group.entries) {
          linkRows.push({
            obligation_id:        oblId,
            link_type:            'CARD_COMPONENT',
            normalized_transaction_id: e.ntId,
            card_transaction_id:  e.cardTxId,
            contributing_amount:  e.grossAmount,
          });
        }
      }

      if (linkRows.length > 0) {
        const { error: linkErr } = await supabase
          .from('obligation_source_links')
          .insert(linkRows);
        if (linkErr) errors.push(`card source_link insert: ${linkErr.message}`);
      }
    }
  }

  // 기존 그룹 obligation에 새 카드 거래 링크 추가 (카드 NT 재투영 시)
  if (existingObls && existingObls.length > 0) {
    const existingMap = new Map(
      (existingObls as { id: string; card_settlement_group_key: string }[]).map(r => [r.card_settlement_group_key, r.id])
    );
    const extraLinkRows = [];
    for (const e of entries) {
      const oblId = existingMap.get(e.groupKey);
      if (!oblId) continue;
      extraLinkRows.push({
        obligation_id:             oblId,
        link_type:                 'CARD_COMPONENT',
        normalized_transaction_id: e.ntId,
        card_transaction_id:       e.cardTxId,
        contributing_amount:       e.grossAmount,
      });
    }
    if (extraLinkRows.length > 0) {
      const { error: linkErr } = await supabase
        .from('obligation_source_links')
        .upsert(extraLinkRows, { onConflict: 'obligation_id,card_transaction_id', ignoreDuplicates: true });
      if (linkErr) errors.push(`card extra source_link upsert: ${linkErr.message}`);
    }
  }

  return { count: newCount, errors };
}

// ── 3. 고정비 규칙 → obligation ───────────────────────────────────────────────

async function projectFixedCostObligations(
  supabase:       SupabaseClient,
  companyId:      string,
  companyCode:    CompanyCode,
  fixedCostMonth?: string,
): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  const month = fixedCostMonth ?? new Date().toISOString().slice(0, 7); // YYYY-MM

  // 활성 고정비 규칙 조회
  const { data: rules, error: ruleErr } = await supabase
    .from('fixed_cost_rules')
    .select('id, company_id, amount, description, day_of_month, obligation_type')
    .eq('company_id', companyId)
    .eq('is_active', true);

  if (ruleErr) return { count: 0, errors: [`fixed_cost_rules query: ${ruleErr.message}`] };
  if (!rules || rules.length === 0) return { count: 0, errors: [] };

  // 이미 존재하는 의무 확인
  const ruleIds = rules.map((r: { id: string }) => r.id);
  const { data: existing } = await supabase
    .from('obligations')
    .select('generated_from_fixed_cost_rule_id, fixed_cost_month')
    .eq('company_id', companyId)
    .eq('fixed_cost_month', month)
    .in('generated_from_fixed_cost_rule_id', ruleIds);

  const existingRuleSet = new Set(
    (existing ?? []).map((o: { generated_from_fixed_cost_rule_id: string }) => o.generated_from_fixed_cost_rule_id)
  );

  const [yearStr, monthStr] = month.split('-');
  const year  = parseInt(yearStr, 10);
  const mon   = parseInt(monthStr, 10);

  const newOblRows = rules
    .filter((r: { id: string }) => !existingRuleSet.has(r.id))
    .map((r: { id: string; amount: number; description: string; day_of_month: number; obligation_type: string }) => {
      const day = String(r.day_of_month).padStart(2, '0');
      const dueDate = `${year}-${monthStr}-${day}`;
      return {
        company_id:                        companyId,
        company_code:                      companyCode,
        origin_type:                       'FIXED_COST_RULE',
        obligation_type:                   r.obligation_type ?? 'PAYABLE',
        obligation_subtype:                'FIXED_COST',
        due_date:                          dueDate,
        gross_amount:                      r.amount,
        generated_from_fixed_cost_rule_id: r.id,
        fixed_cost_month:                  month,
        counterparty_name:                 r.description,
        is_user_locked:                    false,
        is_cancelled:                      false,
        is_superseded:                     false,
      };
    });

  if (newOblRows.length === 0) return { count: 0, errors: [] };

  const { error: insertErr, count } = await supabase
    .from('obligations')
    .insert(newOblRows)
    .select('id, generated_from_fixed_cost_rule_id');

  if (insertErr) {
    errors.push(`fixed_cost obligation insert: ${insertErr.message}`);
    return { count: 0, errors };
  }

  // 고정비는 obligation_source_links에 FIXED_COST_SOURCE로 연결
  // (inserted로 반환된 rows 사용)
  // 참고: fixed_cost_rules는 normalized_transactions를 생성하지 않으므로
  //       link의 normalized_transaction_id = NULL, fixed_cost_rule_id만 채움

  return { count: count ?? newOblRows.length, errors };
}
