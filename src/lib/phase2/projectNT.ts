/**
 * Phase 2A: Normalized Transaction 투영
 *
 * 은행/카드/홈택스 소스 레코드를 normalized_transactions에 반영.
 * 각 소스 FK에 대해 이미 NT가 있으면 UPSERT(ON CONFLICT DO NOTHING)로 스킵.
 *
 * 호출 시점: upload 완료 직후 (import → NT 투영 → cash_event/obligation 투영)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyCode } from '../types';

export interface ProjectNTOptions {
  companyId:   string;
  companyCode: CompanyCode;
  /** 특정 소스 ID 목록만 처리할 때 사용 (null이면 미투영 전체) */
  bankIds?:    string[];
  cardIds?:    string[];
  htIds?:      string[];
}

export interface ProjectNTResult {
  bank:   number;
  card:   number;
  ht:     number;
  errors: string[];
}

export async function projectNormalizedTransactions(
  supabase: SupabaseClient,
  opts:     ProjectNTOptions,
): Promise<ProjectNTResult> {
  const { companyId, companyCode, bankIds, cardIds, htIds } = opts;
  const result: ProjectNTResult = { bank: 0, card: 0, ht: 0, errors: [] };

  // ── 1. 은행 거래 → REALIZED NT ───────────────────────────────────────────────
  {
    let q = supabase
      .from('bank_transactions')
      .select('id, transaction_date, amount, transaction_type, description, account_no, source_type')
      .eq('company_id', companyId);

    if (bankIds) {
      q = q.in('id', bankIds);
    } else {
      // 아직 NT 없는 것만
      const { data: existing } = await supabase
        .from('normalized_transactions')
        .select('bank_transaction_id')
        .eq('company_id', companyId)
        .not('bank_transaction_id', 'is', null);
      const existingIds = (existing ?? []).map((r: { bank_transaction_id: string }) => r.bank_transaction_id);
      if (existingIds.length > 0) q = q.not('id', 'in', `(${existingIds.join(',')})`);
    }

    const { data: rows, error } = await q;
    if (error) {
      result.errors.push(`bank NT query: ${error.message}`);
    } else if (rows && rows.length > 0) {
      const ntRows = rows.map((r: {
        id: string;
        transaction_date: string;
        amount: number;
        transaction_type: string;
        description: string | null;
        account_no: string | null;
        source_type: string | null;
      }) => ({
        company_id:          companyId,
        company_code:        companyCode,
        bank_transaction_id: r.id,
        card_transaction_id: null,
        hometax_invoice_id:  null,
        event_type:          r.transaction_type === 'deposit' ? 'REALIZED_INFLOW' : 'REALIZED_OUTFLOW',
        event_date:          r.transaction_date,
        gross_amount:        Math.abs(r.amount),
        counterparty_name:   r.description ?? null,
        counterparty_business_no: null,
        is_projected:        true,
        projected_at:        new Date().toISOString(),
      }));

      const { error: insertErr, count } = await supabase
        .from('normalized_transactions')
        .upsert(ntRows, { onConflict: 'bank_transaction_id', ignoreDuplicates: true, count: 'exact' });

      if (insertErr) result.errors.push(`bank NT upsert: ${insertErr.message}`);
      else result.bank = count ?? ntRows.length;
    }
  }

  // ── 2. 카드 거래 → EXPECTED_OUTFLOW NT ──────────────────────────────────────
  {
    let q = supabase
      .from('card_transactions')
      .select('id, transaction_date, amount, merchant_name, business_no, payment_due_date, source_type')
      .eq('company_id', companyId);

    if (cardIds) {
      q = q.in('id', cardIds);
    } else {
      const { data: existing } = await supabase
        .from('normalized_transactions')
        .select('card_transaction_id')
        .eq('company_id', companyId)
        .not('card_transaction_id', 'is', null);
      const existingIds = (existing ?? []).map((r: { card_transaction_id: string }) => r.card_transaction_id);
      if (existingIds.length > 0) q = q.not('id', 'in', `(${existingIds.join(',')})`);
    }

    const { data: rows, error } = await q;
    if (error) {
      result.errors.push(`card NT query: ${error.message}`);
    } else if (rows && rows.length > 0) {
      const ntRows = rows.map((r: {
        id: string;
        transaction_date: string;
        amount: number;
        merchant_name: string | null;
        business_no: string | null;
      }) => ({
        company_id:               companyId,
        company_code:             companyCode,
        bank_transaction_id:      null,
        card_transaction_id:      r.id,
        hometax_invoice_id:       null,
        event_type:               'EXPECTED_OUTFLOW',
        event_date:               r.transaction_date,
        gross_amount:             Math.abs(r.amount),
        counterparty_name:        r.merchant_name ?? null,
        counterparty_business_no: r.business_no ?? null,
        is_projected:             true,
        projected_at:             new Date().toISOString(),
      }));

      const { error: insertErr, count } = await supabase
        .from('normalized_transactions')
        .upsert(ntRows, { onConflict: 'card_transaction_id', ignoreDuplicates: true, count: 'exact' });

      if (insertErr) result.errors.push(`card NT upsert: ${insertErr.message}`);
      else result.card = count ?? ntRows.length;
    }
  }

  // ── 3. 홈택스 세금계산서 → EXPECTED NT ──────────────────────────────────────
  {
    let q = supabase
      .from('hometax_invoices')
      .select('id, issue_date, supply_amount, tax_amount, invoice_direction, counterparty, business_no')
      .eq('company_id', companyId);

    if (htIds) {
      q = q.in('id', htIds);
    } else {
      const { data: existing } = await supabase
        .from('normalized_transactions')
        .select('hometax_invoice_id')
        .eq('company_id', companyId)
        .not('hometax_invoice_id', 'is', null);
      const existingIds = (existing ?? []).map((r: { hometax_invoice_id: string }) => r.hometax_invoice_id);
      if (existingIds.length > 0) q = q.not('id', 'in', `(${existingIds.join(',')})`);
    }

    const { data: rows, error } = await q;
    if (error) {
      result.errors.push(`ht NT query: ${error.message}`);
    } else if (rows && rows.length > 0) {
      const ntRows = rows.map((r: {
        id: string;
        issue_date: string;
        supply_amount: number;
        tax_amount: number;
        invoice_direction: 'sales' | 'purchase';
        counterparty: string | null;
        business_no: string | null;
      }) => ({
        company_id:               companyId,
        company_code:             companyCode,
        bank_transaction_id:      null,
        card_transaction_id:      null,
        hometax_invoice_id:       r.id,
        // sales→미수금(유입 예정), purchase→미지급(유출 예정)
        event_type:               r.invoice_direction === 'sales' ? 'EXPECTED_INFLOW' : 'EXPECTED_OUTFLOW',
        event_date:               r.issue_date,
        gross_amount:             r.supply_amount + r.tax_amount,
        counterparty_name:        r.counterparty ?? null,
        counterparty_business_no: r.business_no ?? null,
        is_projected:             true,
        projected_at:             new Date().toISOString(),
      }));

      const { error: insertErr, count } = await supabase
        .from('normalized_transactions')
        .upsert(ntRows, { onConflict: 'hometax_invoice_id', ignoreDuplicates: true, count: 'exact' });

      if (insertErr) result.errors.push(`ht NT upsert: ${insertErr.message}`);
      else result.ht = count ?? ntRows.length;
    }
  }

  return result;
}
