/**
 * importUploadedResults.ts
 *
 * 웹 업로드 파이프라인의 Supabase 반영 단계.
 * - bank / card / hometax: source_hash 기준 upsert (중복 안전)
 * - cashflow_entries: FK(bank/card/ht UUID) 기준 중복 검사 후 insert
 *   → USER_EDITED / USER_CONFIRMED 행은 절대 삭제/수정 금지
 *   → 자동 생성(AUTO_MATCHED, MANUAL_REVIEW, UNMATCHED) 행만 신규 생성
 *
 * TODO: "해당 월 재생성" 버튼 구현 시:
 *   DELETE FROM cashflow_entries
 *   WHERE match_status NOT IN ('USER_EDITED','USER_CONFIRMED','EXCLUDED')
 *     AND entry_date BETWEEN startDate AND endDate
 *   후 전체 재생성.
 */

import * as crypto    from 'crypto';
import { createServerClient } from '../supabase/server';
import { BankTransaction, CardTransaction, HometaxInvoice } from '../types';
import { CashflowEntry }                                     from '../../matching/matcherTypes';

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── 소스 hash 생성 (import-to-supabase.ts와 동일 규칙) ──────────────────────
function bankHash(b: BankTransaction, i: number): string {
  return sha256(`bank|${b.company}|${b.sourceType}|${b.transactionDate}|${b.transactionTime}|${b.description}|${b.withdrawAmount}|${b.depositAmount}|${b.accountNo}`);
}
function cardHash(c: CardTransaction): string {
  return sha256(`card|${c.company}|${c.sourceType}|${c.usedAt}|${c.merchantName}|${c.amount}|${c.approvalNumber}`);
}
function htHash(h: HometaxInvoice): string {
  return sha256(`ht|${h.company}|${h.sourceType}|${h.approvalNumber}|${h.writtenDate}`);
}

// ── bank_transactions DB row ──────────────────────────────────────────────────
function toBankRow(b: BankTransaction, companyMap: Record<string, string>, hash: string) {
  return {
    company_id:           companyMap[b.company]    ?? null,
    company_code:         b.company,
    source_type:          b.sourceType,
    transaction_date:     b.transactionDate,
    transaction_time:     b.transactionTime        || null,
    description:          b.description            || null,
    memo:                 b.memo                   || null,
    withdraw_amount:      b.withdrawAmount,
    deposit_amount:       b.depositAmount,
    balance:              b.balance                ?? null,
    account_no:           b.accountNo              || null,
    counter_account_no:   b.counterAccountNo       || null,
    counter_bank:         b.counterBank            || null,
    counter_account_name: b.counterAccountName     || null,
    tx_type:              b.txType                 || null,
    category_hint:        b.categoryHint           || null,
    source_hash:          hash,
  };
}

function toCardRow(c: CardTransaction, companyMap: Record<string, string>, hash: string) {
  return {
    company_id:          companyMap[c.company]  ?? null,
    company_code:        c.company,
    source_type:         c.sourceType,
    used_at:             c.usedAt               || null,
    used_date:           c.usedAt ? c.usedAt.split('T')[0] : null,
    merchant_name:       c.merchantName         || null,
    amount:              c.amount,
    approval_number:     c.approvalNumber        || null,
    card_no:             c.cardNo               || null,
    business_no:         c.businessNo           || null,
    payment_due_date:    c.paymentDueDate        || null,
    is_cancelled:        c.isCancelled           ?? false,
    cancelled_amount:    c.cancelledAmount       ?? 0,
    domestic_or_foreign: c.domesticOrForeign     || null,
    sales_type:          c.salesType             || null,
    card_provider:       c.cardProvider          || null,
    card_label:          c.cardLabel             || null,
    source_hash:         hash,
  };
}

function toHtRow(h: HometaxInvoice, companyMap: Record<string, string>, hash: string) {
  return {
    company_id:             companyMap[h.company]     ?? null,
    company_code:           h.company,
    source_type:            h.sourceType,
    issue_date:             h.issuedDate,
    written_date:           h.writtenDate            || null,
    approval_number:        h.approvalNumber          || null,
    vendor_name:            h.vendorName              || null,
    customer_name:          h.customerName            || null,
    vendor_business_no:     h.vendorBusinessNo        || null,
    item_name:              h.itemName                || null,
    total_amount:           h.totalAmount,
    supply_amount:          h.supplyAmount,
    tax_amount:             h.taxAmount,
    invoice_direction:      h.invoiceDirection,
    tax_type:               h.taxType,
    invoice_classification: h.invoiceClassification   || null,
    receipt_type:           h.receiptType             || null,
    is_cancelled:           h.isCancelled             ?? false,
    source_hash:            hash,
  };
}

// ── 공개 타입 ─────────────────────────────────────────────────────────────────
export type ImportUploadResult = {
  sessionId:        string;
  bankUpserted:     number;
  cardUpserted:     number;
  htUpserted:       number;
  cashflowCreated:  number;
  cashflowSkipped:  number;
  bankIdMap:        Record<string, string>;  // bank_0 → db uuid
  cardIdMap:        Record<string, string>;
  htIdMap:          Record<string, string>;
  errors:           string[];
};

// ── 메인 함수 ─────────────────────────────────────────────────────────────────
export async function importUploadedResults(
  sessionLabel:    string,
  banks:           BankTransaction[],
  cards:           CardTransaction[],
  hts:             HometaxInvoice[],
  cashflowEntries: CashflowEntry[],
): Promise<ImportUploadResult> {
  const client = createServerClient();
  if (!client) throw new Error('Supabase 클라이언트 생성 실패 (환경변수 확인)');

  const errors: string[] = [];

  // ── 1. 회사 ID 맵 ──────────────────────────────────────────────────────────
  const { data: companies, error: cErr } = await (client as any)
    .from('companies').select('id, company_code');
  if (cErr) throw new Error(`companies 조회 실패: ${cErr.message}`);
  const companyMap: Record<string, string> = Object.fromEntries(
    (companies as any[]).map(c => [c.company_code, c.id])
  );

  // ── 2. upload_session 생성 ─────────────────────────────────────────────────
  const { data: sessionData, error: sErr } = await (client as any)
    .from('upload_sessions')
    .insert({ session_label: sessionLabel, status: 'processing' })
    .select('id');
  if (sErr) throw new Error(`upload_sessions 생성 실패: ${sErr.message}`);
  const sessionId = (sessionData as any[])[0].id;

  // ── 3. bank upsert ─────────────────────────────────────────────────────────
  const bankRows = banks.map((b, i) => {
    const hash = bankHash(b, i);
    return { row: toBankRow(b, companyMap, hash), localId: `bank_${i}`, hash };
  });

  const bankIdMap: Record<string, string> = {};
  let bankUpserted = 0;

  for (const batch of chunk(bankRows, 500)) {
    const { data, error } = await (client as any)
      .from('bank_transactions')
      .upsert(batch.map(b => b.row), { onConflict: 'source_hash' })
      .select('id, source_hash');
    if (error) { errors.push(`bank upsert: ${error.message}`); continue; }
    const h2id: Record<string, string> = Object.fromEntries((data as any[]).map(r => [r.source_hash, r.id]));
    batch.forEach(b => { if (h2id[b.hash]) bankIdMap[b.localId] = h2id[b.hash]; });
    bankUpserted += (data as any[]).length;
  }

  // ── 4. card upsert ─────────────────────────────────────────────────────────
  const cardRows = cards.map((c, i) => {
    const hash = cardHash(c);
    return { row: toCardRow(c, companyMap, hash), localId: `card_${i}`, hash };
  });

  const cardIdMap: Record<string, string> = {};
  let cardUpserted = 0;

  for (const batch of chunk(cardRows, 500)) {
    const { data, error } = await (client as any)
      .from('card_transactions')
      .upsert(batch.map(c => c.row), { onConflict: 'source_hash' })
      .select('id, source_hash');
    if (error) { errors.push(`card upsert: ${error.message}`); continue; }
    const h2id: Record<string, string> = Object.fromEntries((data as any[]).map(r => [r.source_hash, r.id]));
    batch.forEach(c => { if (h2id[c.hash]) cardIdMap[c.localId] = h2id[c.hash]; });
    cardUpserted += (data as any[]).length;
  }

  // ── 5. hometax upsert ─────────────────────────────────────────────────────
  const htRows = hts.map((h, i) => {
    const hash = htHash(h);
    return { row: toHtRow(h, companyMap, hash), localId: `ht_${i}`, hash };
  });

  const htIdMap: Record<string, string> = {};
  let htUpserted = 0;

  for (const batch of chunk(htRows, 500)) {
    const { data, error } = await (client as any)
      .from('hometax_invoices')
      .upsert(batch.map(h => h.row), { onConflict: 'source_hash' })
      .select('id, source_hash');
    if (error) { errors.push(`ht upsert: ${error.message}`); continue; }
    const h2id: Record<string, string> = Object.fromEntries((data as any[]).map(r => [r.source_hash, r.id]));
    batch.forEach(h => { if (h2id[h.hash]) htIdMap[h.localId] = h2id[h.hash]; });
    htUpserted += (data as any[]).length;
  }

  // ── 6. 중복 방지: 이미 처리된 FK 조회 ────────────────────────────────────
  const bankDbIds = Object.values(bankIdMap);
  const cardDbIds = Object.values(cardIdMap);
  const htDbIds   = Object.values(htIdMap);

  const existingFKs = new Set<string>();

  if (bankDbIds.length > 0) {
    const { data } = await (client as any)
      .from('cashflow_entries')
      .select('bank_transaction_id')
      .in('bank_transaction_id', bankDbIds);
    (data ?? []).forEach((r: any) => { if (r.bank_transaction_id) existingFKs.add(r.bank_transaction_id); });
  }
  if (htDbIds.length > 0) {
    const { data } = await (client as any)
      .from('cashflow_entries')
      .select('hometax_invoice_id')
      .in('hometax_invoice_id', htDbIds);
    (data ?? []).forEach((r: any) => { if (r.hometax_invoice_id) existingFKs.add(r.hometax_invoice_id); });
  }
  if (cardDbIds.length > 0) {
    const { data } = await (client as any)
      .from('cashflow_entries')
      .select('card_transaction_id')
      .in('card_transaction_id', cardDbIds);
    (data ?? []).forEach((r: any) => { if (r.card_transaction_id) existingFKs.add(r.card_transaction_id); });
  }

  // ── 7. cashflow_entries insert ─────────────────────────────────────────────
  let cashflowCreated = 0;
  let cashflowSkipped = 0;

  const cfRows: object[] = [];

  for (const e of cashflowEntries) {
    const bankDbId = e.bankTransactionId ? (bankIdMap[e.bankTransactionId] ?? null) : null;
    const cardDbId = e.cardTransactionId ? (cardIdMap[e.cardTransactionId] ?? null) : null;
    const htDbId   = e.hometaxInvoiceId  ? (htIdMap[e.hometaxInvoiceId]   ?? null) : null;

    // 중복 방지: 이미 해당 FK로 cashflow_entry가 있으면 skip
    if (bankDbId && existingFKs.has(bankDbId)) { cashflowSkipped++; continue; }
    if (htDbId   && existingFKs.has(htDbId))   { cashflowSkipped++; continue; }
    if (cardDbId && existingFKs.has(cardDbId))  { cashflowSkipped++; continue; }

    cfRows.push({
      company_id:          companyMap[e.company]           ?? null,
      company_code:        e.company,
      entry_date:          e.date,
      vendor_name:         e.vendorName,
      category:            e.category,
      sub_category:        e.subCategory                   || null,
      income_amount:       e.incomeAmount,
      expense_amount:      e.expenseAmount,
      source_type:         e.sourceType,
      payment_source_type: e.paymentSourceType             || null,
      match_status:        e.matchStatus,
      match_reason:        e.matchReason                   || null,
      hometax_invoice_id:  htDbId,
      bank_transaction_id: bankDbId,
      card_transaction_id: cardDbId,
    });
  }

  for (const batch of chunk(cfRows, 500)) {
    const { data, error } = await (client as any)
      .from('cashflow_entries')
      .insert(batch)
      .select('id');
    if (error) {
      errors.push(`cashflow insert: ${error.message}`);
    } else {
      cashflowCreated += (data as any[]).length;
    }
  }

  // ── 8. session 완료 처리 ───────────────────────────────────────────────────
  await (client as any)
    .from('upload_sessions')
    .update({
      status:           errors.length > 0 ? 'error' : 'completed',
      error_message:    errors.length > 0 ? errors.join('; ') : null,
      parsed_row_count: cashflowCreated,
      processed_at:     new Date().toISOString(),
    })
    .eq('id', sessionId);

  return {
    sessionId, bankUpserted, cardUpserted, htUpserted,
    cashflowCreated, cashflowSkipped,
    bankIdMap, cardIdMap, htIdMap, errors,
  };
}
