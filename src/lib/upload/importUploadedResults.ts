/**
 * importUploadedResults.ts
 *
 * 웹 업로드 파이프라인의 Supabase 반영 단계 (Phase 1 리팩터).
 *
 * 파일별 처리:
 *   - Supabase Storage(finance-raw)에 원본 파일 보관
 *   - source_files 레코드 생성 (상태 전이: pending → storage_uploaded → importing → success/partial/error)
 *   - bank/card/HT: 기존 source_hash 사전 조회 후 신규만 INSERT (DO NOTHING 시맨틱)
 *   - transaction_source_links: 신규=PRIMARY, 중복=DUPLICATE_SOURCE (원본 계보 보존)
 *   - source_parse_warnings: 오류 행의 raw_row_json 포함
 *   - finance_audit_logs: IMPORT_COMPLETE
 *
 * 불변 원칙:
 *   - USER_EDITED / USER_CONFIRMED cashflow_entries 절대 삭제·수정 금지
 *   - source_hash 충돌 시 기존 행의 source_row_number·source_file_id 덮어쓰지 않음
 *   - Storage는 service_role key가 RLS 우회 → 브라우저 직접 접근 정책 없음
 */

import * as crypto    from 'crypto';
import { createServerClient } from '../supabase/server';
import {
  BankTransaction, CardTransaction, HometaxInvoice,
  SourceType, CompanyCode, ParseError,
} from '../types';
import { CashflowEntry } from '../../matching/matcherTypes';

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── source_hash 생성 (import-to-supabase.ts와 동일 규칙) ────────────────────
function bankHash(b: BankTransaction): string {
  return sha256(`bank|${b.company}|${b.sourceType}|${b.transactionDate}|${b.transactionTime}|${b.description}|${b.withdrawAmount}|${b.depositAmount}|${b.accountNo}`);
}
function cardHash(c: CardTransaction): string {
  return sha256(`card|${c.company}|${c.sourceType}|${c.usedAt}|${c.merchantName}|${c.amount}|${c.approvalNumber}`);
}
function htHash(h: HometaxInvoice): string {
  return sha256(`ht|${h.company}|${h.sourceType}|${h.approvalNumber}|${h.writtenDate}`);
}

// ── DB row 변환 ──────────────────────────────────────────────────────────────
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
    source_row_number:    b.sourceRowNumber        ?? null,
    source_sheet_name:    b.sourceSheetName        ?? null,
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
    source_row_number:   c.sourceRowNumber       ?? null,
    source_sheet_name:   c.sourceSheetName       ?? null,
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
    source_row_number:      h.sourceRowNumber         ?? null,
    source_sheet_name:      h.sourceSheetName         ?? null,
  };
}

// ── 공개 타입 ─────────────────────────────────────────────────────────────────
export type PerFileGroup = {
  filename:           string;
  buffer:             Buffer;
  sourceType:         SourceType | null;
  companyCode:        CompanyCode | null;
  detectedSourceType: string | null;
  banks:              BankTransaction[];
  cards:              CardTransaction[];
  hts:                HometaxInvoice[];
  parseErrors:        ParseError[];
};

export type ImportUploadResult = {
  sessionId:        string;
  bankUpserted:     number;
  cardUpserted:     number;
  htUpserted:       number;
  cashflowCreated:  number;
  cashflowSkipped:  number;
  bankIdMap:        Record<string, string>;  // bank_N → db uuid
  cardIdMap:        Record<string, string>;
  htIdMap:          Record<string, string>;
  errors:           string[];
};

// ── 파일별 은행/카드/HT 처리 헬퍼 ───────────────────────────────────────────

type HashEntry<T> = {
  row:             T;
  localId:         string;
  hash:            string;
  sourceRowNumber: number | undefined;
  sourceSheetName: string | undefined;
};

async function upsertWithLinks<T extends object>(
  client:       any,
  tableName:    string,
  entries:      HashEntry<T>[],
  idMap:        Record<string, string>,
  sourceFileId: string | null,
  linkField:    'bank_transaction_id' | 'card_transaction_id' | 'hometax_invoice_id',
  errors:       string[],
  filename:     string,
): Promise<number> {
  let upserted = 0;
  for (const batch of chunk(entries, 500)) {
    const hashes = batch.map(e => e.hash);

    // 기존 hash → id 조회
    const { data: existing } = await client
      .from(tableName)
      .select('id, source_hash')
      .in('source_hash', hashes);
    const existingMap: Record<string, string> = Object.fromEntries(
      (existing ?? []).map((r: any) => [r.source_hash, r.id])
    );

    // 신규 행만 INSERT — source_file_id 주입 (기존 행은 절대 덮어쓰지 않음)
    const newEntries = batch.filter(e => !existingMap[e.hash]);
    if (newEntries.length > 0) {
      const { data: inserted, error: insertErr } = await client
        .from(tableName)
        .insert(newEntries.map(e => ({ ...e.row, source_file_id: sourceFileId })))
        .select('id, source_hash');
      if (insertErr) {
        errors.push(`${tableName} insert (${filename}): ${insertErr.message}`);
      } else {
        const h2id: Record<string, string> = Object.fromEntries(
          (inserted as any[]).map((r: any) => [r.source_hash, r.id])
        );
        newEntries.forEach(e => { if (h2id[e.hash]) idMap[e.localId] = h2id[e.hash]; });
        upserted += (inserted as any[]).length;
      }
    }

    // 기존 행 ID 맵 등록
    batch.forEach(e => { if (existingMap[e.hash] && !idMap[e.localId]) idMap[e.localId] = existingMap[e.hash]; });

    // transaction_source_links INSERT
    if (sourceFileId) {
      const linkRows = batch.flatMap(e => {
        const txId = idMap[e.localId];
        if (!txId) return [];
        return [{
          source_file_id:    sourceFileId,
          source_row_number: e.sourceRowNumber ?? null,
          source_sheet_name: e.sourceSheetName ?? null,
          [linkField]:       txId,
          link_type:         existingMap[e.hash] ? 'DUPLICATE_SOURCE' : 'PRIMARY',
        }];
      });
      if (linkRows.length > 0) {
        const { error: linkErr } = await client.from('transaction_source_links').insert(linkRows);
        if (linkErr) errors.push(`transaction_source_links (${filename}): ${linkErr.message}`);
      }
    }
  }
  return upserted;
}

// ── 메인 함수 ─────────────────────────────────────────────────────────────────
export async function importUploadedResults(
  sessionLabel:    string,
  perFileGroups:   PerFileGroup[],
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

  // ── 3. 파일별 처리 ─────────────────────────────────────────────────────────
  const bankIdMap: Record<string, string> = {};
  const cardIdMap: Record<string, string> = {};
  const htIdMap:   Record<string, string> = {};
  let bankUpserted = 0, cardUpserted = 0, htUpserted = 0;
  let globalBankIdx = 0, globalCardIdx = 0, globalHtIdx = 0;

  for (const group of perFileGroups) {
    const { filename, buffer, sourceType, companyCode, detectedSourceType, banks, cards, hts, parseErrors } = group;
    const fileCompanyId = companyCode ? (companyMap[companyCode] ?? null) : null;
    const fileContentHash = sha256(buffer.toString('binary'));
    const today = new Date().toISOString().split('T')[0];

    // ── 3a. source_files INSERT (status=pending) ───────────────────────────
    let sourceFileId: string | null = null;
    const { data: sfData, error: sfErr } = await (client as any)
      .from('source_files')
      .insert({
        upload_session_id:    sessionId,
        company_id:           fileCompanyId,
        company_code:         companyCode,
        filename,
        file_type:            sourceType,
        detected_source_type: detectedSourceType || sourceType,
        file_size_bytes:      buffer.length,
        file_content_hash:    fileContentHash,
        parse_date:           today,
        record_count:         banks.length + cards.length + hts.length,
        status:               'pending',
        parse_warning_count:  parseErrors.length,
        error_row_count:      parseErrors.length,
        success_row_count:    banks.length + cards.length + hts.length,
      })
      .select('id');
    if (sfErr) {
      errors.push(`source_files 생성 실패 (${filename}): ${sfErr.message}`);
    } else {
      sourceFileId = (sfData as any[])[0].id;
    }

    // ── 3b. Storage 업로드 ─────────────────────────────────────────────────
    if (sourceFileId) {
      const datePart    = new Date().toISOString().slice(0, 7);
      const company     = companyCode ?? 'unknown';
      const safeFilename = filename.replace(/\s+/g, '_');
      const storagePath  = `${company}/${datePart}/${Date.now()}_${safeFilename}`;

      const { error: storageErr } = await (client as any).storage
        .from('finance-raw')
        .upload(storagePath, buffer, { contentType: 'application/octet-stream', upsert: false });

      if (storageErr) {
        errors.push(`Storage 업로드 실패 (${filename}): ${storageErr.message}`);
        await (client as any).from('source_files').update({ status: 'error' }).eq('id', sourceFileId);
      } else {
        await (client as any).from('source_files').update({
          status:            'storage_uploaded',
          storage_path:      storagePath,
          storage_mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }).eq('id', sourceFileId);
      }
    }

    // ── 3c. source_parse_warnings INSERT ──────────────────────────────────
    if (sourceFileId && parseErrors.length > 0) {
      const warningRows = parseErrors.map(e => ({
        source_file_id:    sourceFileId,
        source_row_number: e.rowIndex + 1,  // rowIndex는 0-based 배열 인덱스
        severity:          'error',
        error_code:        'PARSE_ERROR',
        message:           e.message,
        raw_row_json:      e.rawData ? JSON.parse(JSON.stringify(e.rawData)) : null,
      }));
      const { error: wErr } = await (client as any).from('source_parse_warnings').insert(warningRows);
      if (wErr) errors.push(`parse_warnings 저장 실패 (${filename}): ${wErr.message}`);
    }

    // ── 3d. status = 'importing' ───────────────────────────────────────────
    if (sourceFileId) {
      await (client as any).from('source_files').update({ status: 'importing' }).eq('id', sourceFileId);
    }

    // ── 3e. bank INSERT + transaction_source_links ─────────────────────────
    if (banks.length > 0) {
      const entries: HashEntry<ReturnType<typeof toBankRow>>[] = banks.map((b, localIdx) => {
        const globalIdx = globalBankIdx + localIdx;
        return {
          row:             toBankRow(b, companyMap, bankHash(b)),
          localId:         `bank_${globalIdx}`,
          hash:            bankHash(b),
          sourceRowNumber: b.sourceRowNumber,
          sourceSheetName: b.sourceSheetName,
        };
      });
      bankUpserted += await upsertWithLinks(
        client as any, 'bank_transactions', entries, bankIdMap,
        sourceFileId, 'bank_transaction_id', errors, filename,
      );
      globalBankIdx += banks.length;
    }

    // ── 3f. card INSERT + transaction_source_links ─────────────────────────
    if (cards.length > 0) {
      const entries: HashEntry<ReturnType<typeof toCardRow>>[] = cards.map((c, localIdx) => {
        const globalIdx = globalCardIdx + localIdx;
        return {
          row:             toCardRow(c, companyMap, cardHash(c)),
          localId:         `card_${globalIdx}`,
          hash:            cardHash(c),
          sourceRowNumber: c.sourceRowNumber,
          sourceSheetName: c.sourceSheetName,
        };
      });
      cardUpserted += await upsertWithLinks(
        client as any, 'card_transactions', entries, cardIdMap,
        sourceFileId, 'card_transaction_id', errors, filename,
      );
      globalCardIdx += cards.length;
    }

    // ── 3g. hometax INSERT + transaction_source_links ──────────────────────
    if (hts.length > 0) {
      const entries: HashEntry<ReturnType<typeof toHtRow>>[] = hts.map((h, localIdx) => {
        const globalIdx = globalHtIdx + localIdx;
        return {
          row:             toHtRow(h, companyMap, htHash(h)),
          localId:         `ht_${globalIdx}`,
          hash:            htHash(h),
          sourceRowNumber: h.sourceRowNumber,
          sourceSheetName: h.sourceSheetName,
        };
      });
      htUpserted += await upsertWithLinks(
        client as any, 'hometax_invoices', entries, htIdMap,
        sourceFileId, 'hometax_invoice_id', errors, filename,
      );
      globalHtIdx += hts.length;
    }

    // ── 3h. source_files 최종 상태 업데이트 ───────────────────────────────
    if (sourceFileId) {
      const fileErrors = errors.filter(e => e.includes(filename));
      const hasData    = banks.length + cards.length + hts.length > 0;
      const finalStatus =
        fileErrors.length > 0 && !hasData ? 'error' :
        fileErrors.length > 0 && hasData  ? 'partial' :
        parseErrors.length > 0 && hasData ? 'partial' :
        'success';
      await (client as any).from('source_files').update({ status: finalStatus }).eq('id', sourceFileId);
    }

    // ── 3i. finance_audit_logs: IMPORT_COMPLETE ────────────────────────────
    if (sourceFileId) {
      await (client as any).from('finance_audit_logs').insert({
        company_id:   fileCompanyId,
        company_code: companyCode,
        entity_type:  'source_file',
        entity_id:    sourceFileId,
        action_type:  'IMPORT_COMPLETE',
        after_json: {
          filename,
          bank_count:  banks.length,
          card_count:  cards.length,
          ht_count:    hts.length,
          error_count: parseErrors.length,
        },
        actor_id: 'system',
      });
    }
  }

  // ── 4. 중복 방지: 이미 처리된 FK 조회 ────────────────────────────────────
  const bankDbIds = Object.values(bankIdMap);
  const cardDbIds = Object.values(cardIdMap);
  const htDbIds   = Object.values(htIdMap);
  const existingFKs = new Set<string>();

  if (bankDbIds.length > 0) {
    const { data } = await (client as any)
      .from('cashflow_entries').select('bank_transaction_id').in('bank_transaction_id', bankDbIds);
    (data ?? []).forEach((r: any) => { if (r.bank_transaction_id) existingFKs.add(r.bank_transaction_id); });
  }
  if (htDbIds.length > 0) {
    const { data } = await (client as any)
      .from('cashflow_entries').select('hometax_invoice_id').in('hometax_invoice_id', htDbIds);
    (data ?? []).forEach((r: any) => { if (r.hometax_invoice_id) existingFKs.add(r.hometax_invoice_id); });
  }
  if (cardDbIds.length > 0) {
    const { data } = await (client as any)
      .from('cashflow_entries').select('card_transaction_id').in('card_transaction_id', cardDbIds);
    (data ?? []).forEach((r: any) => { if (r.card_transaction_id) existingFKs.add(r.card_transaction_id); });
  }

  // ── 5. cashflow_entries insert ─────────────────────────────────────────────
  let cashflowCreated = 0;
  let cashflowSkipped = 0;
  const cfRows: object[] = [];

  for (const e of cashflowEntries) {
    const bankDbId = e.bankTransactionId ? (bankIdMap[e.bankTransactionId] ?? null) : null;
    const cardDbId = e.cardTransactionId ? (cardIdMap[e.cardTransactionId] ?? null) : null;
    const htDbId   = e.hometaxInvoiceId  ? (htIdMap[e.hometaxInvoiceId]   ?? null) : null;

    if (bankDbId && existingFKs.has(bankDbId)) { cashflowSkipped++; continue; }
    if (htDbId   && existingFKs.has(htDbId))   { cashflowSkipped++; continue; }
    if (cardDbId && existingFKs.has(cardDbId))  { cashflowSkipped++; continue; }

    cfRows.push({
      company_id:           companyMap[e.company]       ?? null,
      company_code:         e.company,
      entry_date:           e.date,
      vendor_name:          e.vendorName,
      category:             e.category,
      sub_category:         e.subCategory               || null,
      income_amount:        e.incomeAmount,
      expense_amount:       e.expenseAmount,
      source_type:          e.sourceType,
      payment_source_type:  e.paymentSourceType         || null,
      match_status:         e.matchStatus,
      match_reason:         e.matchReason               || null,
      hometax_invoice_id:   htDbId,
      bank_transaction_id:  bankDbId,
      card_transaction_id:  cardDbId,
      amount_status:        e.amountStatus              ?? null,
      invoice_amount:       e.invoiceAmount             ?? 0,
      actual_amount:        e.actualAmount              ?? 0,
      accumulated_amount:   e.accumulatedAmount         ?? 0,
      remaining_amount:     e.remainingAmount           ?? 0,
      actual_date:          e.actualDate                ?? null,
      show_in_cashflow:     e.showInCashflow            ?? true,
      category_auto:        e.categoryAuto              ?? null,
      classification_basis: e.classificationBasis       ?? null,
    });
  }

  for (const batch of chunk(cfRows, 500)) {
    const { data, error } = await (client as any)
      .from('cashflow_entries').insert(batch).select('id');
    if (error) errors.push(`cashflow insert: ${error.message}`);
    else cashflowCreated += (data as any[]).length;
  }

  // ── 6. session 완료 처리 ───────────────────────────────────────────────────
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
