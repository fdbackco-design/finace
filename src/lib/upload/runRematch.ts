/**
 * runRematch.ts
 *
 * DB의 기존 bank/card/hometax 데이터를 불러와 매칭 엔진을 재실행하고
 * 자동 생성된 cashflow_entries(USER_EDITED/USER_CONFIRMED 제외)를 교체한다.
 *
 * 날짜 전략:
 *  - HT 계산서: 대상 월의 발급일(issue_date) 기준
 *  - 은행/카드: 대상 월 ±60일 (60일 지급 유예 대응)
 */

import { BankTransaction, CardTransaction, HometaxInvoice, CompanyCode } from '../types';
import { FixedCostEntry } from '../../matching/matcherTypes';
import { MatchingEngine }  from '../../matching/engine';
import { createServerClient } from '../supabase/server';

// ── DB row → 엔진 타입 변환 ─────────────────────────────────────────────────

function toBank(r: any): BankTransaction {
  return {
    company:            r.company_code          as CompanyCode,
    sourceType:         r.source_type,
    transactionDate:    r.transaction_date       ?? '',
    transactionTime:    r.transaction_time       ?? '',
    description:        r.description            ?? '',
    memo:               r.memo                   ?? '',
    withdrawAmount:     Number(r.withdraw_amount ?? 0),
    depositAmount:      Number(r.deposit_amount  ?? 0),
    balance:            Number(r.balance         ?? 0),
    accountNo:          r.account_no             ?? '',
    counterAccountNo:   r.counter_account_no     ?? '',
    counterBank:        r.counter_bank           ?? '',
    counterAccountName: r.counter_account_name   ?? '',
    txType:             r.tx_type                ?? '',
    categoryHint:       r.category_hint          ?? '',
  };
}

function toCard(r: any): CardTransaction {
  return {
    company:           r.company_code           as CompanyCode,
    sourceType:        r.source_type,
    usedAt:            r.used_at ?? (r.used_date ? `${r.used_date}T00:00:00` : ''),
    merchantName:      r.merchant_name          ?? '',
    amount:            Number(r.amount          ?? 0),
    approvalNumber:    r.approval_number        ?? '',
    cardNo:            r.card_no                ?? '',
    businessNo:        r.business_no            ?? '',
    paymentDueDate:    r.payment_due_date        ?? '',
    isCancelled:       Boolean(r.is_cancelled),
    cancelledAmount:   Number(r.cancelled_amount ?? 0),
    domesticOrForeign: r.domestic_or_foreign    ?? '',
    salesType:         r.sales_type             ?? '',
    cardProvider:      r.card_provider          ?? null,
    cardLabel:         r.card_label             ?? null,
  };
}

function toHT(r: any): HometaxInvoice {
  return {
    company:                r.company_code           as CompanyCode,
    sourceType:             r.source_type,
    writtenDate:            r.written_date ?? r.issue_date ?? '',
    issuedDate:             r.issue_date             ?? '',
    approvalNumber:         r.approval_number        ?? '',
    vendorName:             r.vendor_name            ?? '',
    customerName:           r.customer_name          ?? '',
    vendorBusinessNo:       r.vendor_business_no     ?? '',
    itemName:               r.item_name              ?? '',
    totalAmount:            Number(r.total_amount    ?? 0),
    supplyAmount:           Number(r.supply_amount   ?? 0),
    taxAmount:              Number(r.tax_amount      ?? 0),
    invoiceDirection:       r.invoice_direction,
    taxType:                r.tax_type,
    invoiceClassification:  r.invoice_classification ?? '',
    receiptType:            r.receipt_type           ?? '',
    isCancelled:            Boolean(r.is_cancelled),
  };
}

// ── 날짜 계산 헬퍼 ───────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── 메인 함수 ─────────────────────────────────────────────────────────────────

export type RematchResult = {
  deletedCount:  number;
  createdCount:  number;
  autoMatched:   number;
  manualReview:  number;
  unmatched:     number;
  skipped:       number;
  errors:        string[];
};

export async function runRematch(month: string): Promise<RematchResult> {
  const client = createServerClient();
  if (!client) throw new Error('Supabase 클라이언트 생성 실패');

  const errors: string[] = [];
  const [yearStr, monStr] = month.split('-');
  const year = Number(yearStr), mon = Number(monStr);
  const lastDay  = new Date(year, mon, 0).getDate();
  const monthStart = `${month}-01`;
  const monthEnd   = `${month}-${String(lastDay).padStart(2, '0')}`;
  const bankFrom   = addDays(monthStart, -60);
  const bankTo     = addDays(monthEnd,    60);

  // ── 회사 ID 맵 ──────────────────────────────────────────────────────────────
  const { data: companies, error: cErr } = await (client as any)
    .from('companies').select('id, company_code');
  if (cErr) throw new Error(`companies 조회 실패: ${cErr.message}`);
  const companyMap: Record<string, string> = Object.fromEntries(
    (companies as any[]).map(c => [c.company_code, c.id])
  );

  // ── DB에서 원천 데이터 로드 ──────────────────────────────────────────────────
  const { data: bankData, error: bErr } = await (client as any)
    .from('bank_transactions')
    .select('id,company_code,source_type,transaction_date,transaction_time,description,memo,withdraw_amount,deposit_amount,balance,account_no,counter_account_no,counter_bank,counter_account_name,tx_type,category_hint')
    .gte('transaction_date', bankFrom)
    .lte('transaction_date', bankTo);
  if (bErr) errors.push(`bank 로드 실패: ${bErr.message}`);

  const { data: cardData, error: kdErr } = await (client as any)
    .from('card_transactions')
    .select('id,company_code,source_type,used_at,used_date,merchant_name,amount,approval_number,card_no,business_no,payment_due_date,is_cancelled,cancelled_amount,domestic_or_foreign,sales_type,card_provider,card_label')
    .gte('used_date', bankFrom)
    .lte('used_date', bankTo);
  if (kdErr) errors.push(`card 로드 실패: ${kdErr.message}`);

  const { data: htData, error: htErr } = await (client as any)
    .from('hometax_invoices')
    .select('id,company_code,source_type,issue_date,written_date,approval_number,vendor_name,customer_name,vendor_business_no,item_name,total_amount,supply_amount,tax_amount,invoice_direction,tax_type,invoice_classification,receipt_type,is_cancelled')
    .gte('issue_date', monthStart)
    .lte('issue_date', monthEnd);
  if (htErr) errors.push(`hometax 로드 실패: ${htErr.message}`);

  const bankRows = (bankData ?? []) as any[];
  const cardRows = (cardData ?? []) as any[];
  const htRows   = (htData   ?? []) as any[];

  if (bankRows.length + cardRows.length + htRows.length === 0) {
    return { deletedCount: 0, createdCount: 0, autoMatched: 0, manualReview: 0, unmatched: 0, skipped: 0, errors };
  }

  // DB UUID → 엔진 인덱스 역방향 맵 준비
  const bankDbIds = bankRows.map(r => r.id as string);
  const cardDbIds = cardRows.map(r => r.id as string);
  const htDbIds   = htRows.map(r   => r.id as string);

  // ── 고정비 로드 ─────────────────────────────────────────────────────────────
  let fixedCosts: FixedCostEntry[] = [];
  try {
    const { data: fcData } = await (client as any)
      .from('fixed_cost_rules').select('*').eq('is_active', true);
    fixedCosts = ((fcData ?? []) as any[]).map(r => ({
      id:            r.id          ?? '',
      paymentDayRaw: String(r.payment_day ?? ''),
      paymentDay:    Number(r.payment_day ?? 0),
      category:      r.category    ?? '',
      vendorName:    r.vendor_name ?? '',
      amount:        Number(r.amount ?? 0),
      vendorAlias:   r.vendor_alias  ?? '',
      matchKey:      r.match_key     ?? '',
      notes:         '',
      companyRaw:    r.company_code  ?? '',
      company:       r.company_code  ?? 'all',
      paymentType:   r.payment_type  ?? '',
      accountNoStr:  r.account_no_str ?? '',
      vatType:       r.vat_type      ?? '',
      isCardBill:    Boolean(r.is_card_bill),
    })) as FixedCostEntry[];
  } catch (e) { errors.push(`고정비 로드 실패: ${e}`); }

  // ── 매칭 엔진 실행 ─────────────────────────────────────────────────────────
  const engine = new MatchingEngine(
    bankRows.map(toBank),
    cardRows.map(toCard),
    htRows.map(toHT),
    fixedCosts,
  );
  engine.run();

  // 엔진 내부 ID → DB UUID 맵
  const bankDbIdMap: Record<string, string> = {};
  const cardDbIdMap: Record<string, string> = {};
  const htDbIdMap:   Record<string, string> = {};
  bankRows.forEach((r, i) => { bankDbIdMap[`bank_${i}`] = r.id; });
  cardRows.forEach((r, i) => { cardDbIdMap[`card_${i}`] = r.id; });
  htRows.forEach((r, i)   => { htDbIdMap[`ht_${i}`]     = r.id; });

  // ── 기존 자동 생성 항목 삭제 (USER_EDITED / USER_CONFIRMED 제외) ───────────
  // 이번에 처리할 원천 트랜잭션과 연결된 cashflow_entries만 삭제
  const PRESERVED = ['USER_EDITED', 'USER_CONFIRMED'];
  let deletedCount = 0;

  const deleteByFk = async (col: string, ids: string[]) => {
    if (ids.length === 0) return;
    const { data: found } = await (client as any)
      .from('cashflow_entries')
      .select('id, match_status')
      .in(col, ids);
    const toDelete = ((found ?? []) as any[])
      .filter(r => !PRESERVED.includes(r.match_status))
      .map(r => r.id as string);
    if (toDelete.length === 0) return;
    const { error } = await (client as any)
      .from('cashflow_entries')
      .delete()
      .in('id', toDelete);
    if (error) errors.push(`delete ${col}: ${error.message}`);
    else deletedCount += toDelete.length;
  };

  await deleteByFk('bank_transaction_id', bankDbIds);
  await deleteByFk('hometax_invoice_id',  htDbIds);
  await deleteByFk('card_transaction_id', cardDbIds);

  // ── 새 cashflow_entries 삽입 ───────────────────────────────────────────────
  const cfRows: object[] = [];

  for (const e of engine.cashflow) {
    const bankDbId = e.bankTransactionId ? (bankDbIdMap[e.bankTransactionId] ?? null) : null;
    const cardDbId = e.cardTransactionId ? (cardDbIdMap[e.cardTransactionId] ?? null) : null;
    const htDbId   = e.hometaxInvoiceId  ? (htDbIdMap[e.hometaxInvoiceId]   ?? null) : null;

    cfRows.push({
      company_id:           companyMap[e.company]         ?? null,
      company_code:         e.company,
      entry_date:           e.date,
      vendor_name:          e.vendorName,
      category:             e.category,
      sub_category:         e.subCategory                 ?? null,
      income_amount:        e.incomeAmount,
      expense_amount:       e.expenseAmount,
      source_type:          e.sourceType,
      payment_source_type:  e.paymentSourceType           ?? null,
      match_status:         e.matchStatus,
      match_reason:         e.matchReason                 ?? null,
      hometax_invoice_id:   htDbId,
      bank_transaction_id:  bankDbId,
      card_transaction_id:  cardDbId,
      amount_status:        e.amountStatus                ?? null,
      invoice_amount:       e.invoiceAmount               ?? 0,
      actual_amount:        e.actualAmount                ?? 0,
      accumulated_amount:   e.accumulatedAmount           ?? 0,
      remaining_amount:     e.remainingAmount             ?? 0,
      actual_date:          e.actualDate                  ?? null,
      show_in_cashflow:     e.showInCashflow              ?? true,
    });
  }

  let createdCount = 0;
  let skipped = 0;
  const CHUNK = 500;
  for (let i = 0; i < cfRows.length; i += CHUNK) {
    const batch = cfRows.slice(i, i + CHUNK);
    const { data, error } = await (client as any)
      .from('cashflow_entries')
      .insert(batch)
      .select('id');
    if (error) {
      errors.push(`cashflow insert: ${error.message}`);
      skipped += batch.length;
    } else {
      createdCount += (data as any[]).length;
    }
  }

  const cf = engine.cashflow;
  return {
    deletedCount,
    createdCount,
    autoMatched:  cf.filter(e => e.matchStatus === 'AUTO_MATCHED').length,
    manualReview: cf.filter(e => e.matchStatus === 'MANUAL_REVIEW').length,
    unmatched:    cf.filter(e => e.matchStatus === 'UNMATCHED').length,
    skipped,
    errors,
  };
}
