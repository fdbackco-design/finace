import * as fs     from 'fs';
import * as path   from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// ── Env ────────────────────────────────────────────────────────────────────
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH        = 500;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  .env.local 에 NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Helpers ────────────────────────────────────────────────────────────────
const PARSED_DIR = path.resolve(__dirname, '../parsed');

function read<T>(name: string): T[] {
  return JSON.parse(fs.readFileSync(path.join(PARSED_DIR, name), 'utf-8')) as T[];
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function upsertBatch(table: string, records: object[]): Promise<{ id: string; source_hash: string }[]> {
  const results: { id: string; source_hash: string }[] = [];
  for (const batch of chunk(records, BATCH)) {
    const { data, error } = await (supabase as any)
      .from(table)
      .upsert(batch, { onConflict: 'source_hash' })
      .select('id, source_hash');
    if (error) throw new Error(`[${table}] upsert 오류: ${error.message}`);
    results.push(...(data ?? []));
  }
  return results;
}

async function insertBatch(table: string, records: object[]): Promise<void> {
  for (const batch of chunk(records, BATCH)) {
    const { error } = await (supabase as any).from(table).insert(batch);
    if (error) throw new Error(`[${table}] insert 오류: ${error.message}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Supabase Import 시작 ===');
  console.log(`URL: ${SUPABASE_URL}\n`);

  // ── 1. 회사 ID 맵 ──────────────────────────────────────────────────────
  const { data: companies, error: cErr } = await (supabase as any)
    .from('companies').select('id, company_code');
  if (cErr) throw new Error(`companies 조회 실패: ${cErr.message}`);
  const companyMap: Record<string, string> = Object.fromEntries(
    (companies as any[]).map(c => [c.company_code, c.id])
  );
  if (Object.keys(companyMap).length === 0) {
    throw new Error('companies 테이블이 비어있습니다. seed.sql 을 먼저 실행하세요.');
  }
  console.log('회사 맵:', Object.keys(companyMap));

  // ── 2. upload_session 생성 ─────────────────────────────────────────────
  const sessionLabel = `local_import_${new Date().toISOString().replace(/[:.T]/g, '').slice(0, 14)}`;
  const { data: sessions, error: sErr } = await (supabase as any)
    .from('upload_sessions')
    .insert({ session_label: sessionLabel, status: 'completed' })
    .select('id');
  if (sErr) throw new Error(`upload_sessions 생성 실패: ${sErr.message}`);
  const sessionId = (sessions as any[])[0].id;
  console.log(`upload_session: ${sessionId} (${sessionLabel})\n`);

  // ── PASS 1: bank / card / ht upsert ────────────────────────────────────

  // 3. 은행 거래
  const banks = read<any>('bank-transactions.json');
  const bankRecords = banks.map(b => ({
    company_id:           companyMap[b.company],
    company_code:         b.company,
    source_type:          b.sourceType,
    transaction_date:     b.transactionDate,
    transaction_time:     b.transactionTime  || null,
    description:          b.description      || null,
    memo:                 b.memo             || null,
    withdraw_amount:      b.withdrawAmount,
    deposit_amount:       b.depositAmount,
    balance:              b.balance          ?? null,
    account_no:           b.accountNo        || null,
    counter_account_no:   b.counterAccountNo || null,
    counter_bank:         b.counterBank      || null,
    counter_account_name: b.counterAccountName || null,
    tx_type:              b.txType           || null,
    category_hint:        b.categoryHint     || null,
    source_hash: sha256(
      `bank|${b.company}|${b.sourceType}|${b.transactionDate}|${b.transactionTime}|${b.description}|${b.withdrawAmount}|${b.depositAmount}|${b.accountNo}`
    ),
  }));

  const bankDbRows = await upsertBatch('bank_transactions', bankRecords);
  const bankHashToId = Object.fromEntries(bankDbRows.map(r => [r.source_hash, r.id]));
  const bankIdMap: Record<string, string> = {};
  bankRecords.forEach((r, i) => { bankIdMap[`bank_${i}`] = bankHashToId[r.source_hash]; });
  console.log(`은행 거래 적재: ${bankDbRows.length}건`);

  // 4. 카드 거래
  const cards = read<any>('card-transactions.json');
  const cardRecords = cards.map(c => ({
    company_id:          companyMap[c.company],
    company_code:        c.company,
    source_type:         c.sourceType,
    used_at:             c.usedAt            || null,
    used_date:           c.usedAt ? c.usedAt.split('T')[0] : null,
    merchant_name:       c.merchantName      || null,
    amount:              c.amount,
    approval_number:     c.approvalNumber    || null,
    card_no:             c.cardNo            || null,
    business_no:         c.businessNo        || null,
    payment_due_date:    c.paymentDueDate    || null,
    is_cancelled:        c.isCancelled       ?? false,
    cancelled_amount:    c.cancelledAmount   ?? 0,
    domestic_or_foreign: c.domesticOrForeign || null,
    sales_type:          c.salesType         || null,
    card_provider:       c.cardProvider      || null,
    card_label:          c.cardLabel         || null,
    source_hash: sha256(
      `card|${c.company}|${c.sourceType}|${c.usedAt}|${c.merchantName}|${c.amount}|${c.approvalNumber}`
    ),
  }));

  const cardDbRows = await upsertBatch('card_transactions', cardRecords);
  const cardHashToId = Object.fromEntries(cardDbRows.map(r => [r.source_hash, r.id]));
  const cardIdMap: Record<string, string> = {};
  cardRecords.forEach((r, i) => { cardIdMap[`card_${i}`] = cardHashToId[r.source_hash]; });
  console.log(`카드 거래 적재: ${cardDbRows.length}건`);

  // 5. 홈택스 계산서
  const hts = read<any>('hometax-invoices.json');
  const htRecords = hts.map(h => ({
    company_id:             companyMap[h.company],
    company_code:           h.company,
    source_type:            h.sourceType,
    issue_date:             h.issuedDate,
    written_date:           h.writtenDate           || null,
    approval_number:        h.approvalNumber       || null,
    vendor_name:            h.vendorName           || null,
    customer_name:          h.customerName         || null,
    vendor_business_no:     h.vendorBusinessNo     || null,
    item_name:              h.itemName             || null,
    total_amount:           h.totalAmount,
    supply_amount:          h.supplyAmount,
    tax_amount:             h.taxAmount,
    invoice_direction:      h.invoiceDirection,
    tax_type:               h.taxType,
    invoice_classification: h.invoiceClassification || null,
    receipt_type:           h.receiptType           || null,
    is_cancelled:           h.isCancelled           ?? false,
    source_hash: sha256(
      `ht|${h.company}|${h.sourceType}|${h.approvalNumber}|${h.writtenDate}`
    ),
  }));

  const htDbRows = await upsertBatch('hometax_invoices', htRecords);
  const htHashToId = Object.fromEntries(htDbRows.map(r => [r.source_hash, r.id]));
  const htIdMap: Record<string, string> = {};
  htRecords.forEach((r, i) => { htIdMap[`ht_${i}`] = htHashToId[r.source_hash]; });
  console.log(`홈택스 계산서 적재: ${htDbRows.length}건`);

  // ── PASS 2: cashflow_entries insert ─────────────────────────────────────
  const cashflow = read<any>('cashflow-draft.json');
  const cfRecords = cashflow.map((e: any) => ({
    company_id:          companyMap[e.company],
    company_code:        e.company,
    entry_date:          e.date,
    vendor_name:         e.vendorName,
    category:            e.category,
    sub_category:        e.subCategory     || null,
    income_amount:       e.incomeAmount,
    expense_amount:      e.expenseAmount,
    source_type:         e.sourceType,
    payment_source_type: e.paymentSourceType || null,
    match_status:        e.matchStatus,
    match_reason:        e.matchReason      || null,
    hometax_invoice_id:  e.hometaxInvoiceId  ? (htIdMap[e.hometaxInvoiceId]   ?? null) : null,
    bank_transaction_id: e.bankTransactionId ? (bankIdMap[e.bankTransactionId] ?? null) : null,
    card_transaction_id: e.cardTransactionId ? (cardIdMap[e.cardTransactionId] ?? null) : null,
    fixed_cost_id:       null, // fixed_cost_rules는 seed.sql로 별도 관리 — 추후 연결 가능
  }));

  await insertBatch('cashflow_entries', cfRecords);
  console.log(`자금수지현황 적재: ${cfRecords.length}건`);

  // ── 요약 ────────────────────────────────────────────────────────────────
  console.log('\n─'.repeat(50));
  console.log('✅ Import 완료');
  console.log(`   은행 거래:        ${bankDbRows.length}건`);
  console.log(`   카드 거래:        ${cardDbRows.length}건`);
  console.log(`   홈택스 계산서:    ${htDbRows.length}건`);
  console.log(`   자금수지현황 행:  ${cfRecords.length}건`);
}

main().catch(err => {
  console.error('\n❌ Import 실패:', err.message);
  process.exit(1);
});
