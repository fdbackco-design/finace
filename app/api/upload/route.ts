/**
 * POST /api/upload
 *
 * multipart/form-data:
 *   files    — File[] (.xlsx/.xls/.csv, 각 10MB 이하, 최대 20개)
 *   month    — string "YYYY-MM" (참고용, DB 적재 기준 아님 — 파일 내 날짜 사용)
 *   company  — CompanyCode | '' (빈 문자열이면 자동 감지)
 *
 * 응답: UploadApiResponse (아래 타입 참고)
 *
 * TODO 보안 (운영 전 필수):
 *  - Basic Auth 또는 Supabase Auth 관리자 로그인 연동
 *  - Vercel Deployment Protection 설정
 *  - 업로드 감사 로그 (audit_log 테이블 추가)
 *  - Rate limiting (IP 기준)
 *
 * Vercel 주의:
 *  - 서버리스 함수 기본 body limit: 4.5MB (요청 전체 기준)
 *  - 대용량 파일 처리 시 Supabase Storage 업로드 후 처리하는 방식으로 전환 필요
 *  - maxDuration: 최대 60초 (Pro 플랜)
 */

import { NextRequest, NextResponse } from 'next/server';
import { CompanyCode, SourceType }   from '@/src/lib/types';
import { parseUploadedFile }          from '@/src/lib/upload/parseUploadedFile';
import { importUploadedResults, PerFileGroup } from '@/src/lib/upload/importUploadedResults';
import { runRematch }                 from '@/src/lib/upload/runRematch';
import type { BankTransaction, CardTransaction, HometaxInvoice } from '@/src/lib/types';

export const dynamic    = 'force-dynamic';
export const maxDuration = 60; // Vercel Pro 최대 60s

// ── 허용 확장자 / 크기 제한 ──────────────────────────────────────────────────
// Vercel Pro body limit: 4.5MB 전체 기준 → 개별 파일 4MB, 전체 합계 4MB 제한
const ALLOWED_EXT      = ['.xlsx', '.xls', '.csv'];
const MAX_FILE_SIZE    = 4 * 1024 * 1024;   // 4MB per file
const MAX_FILES        = 10;
const TOTAL_SIZE_LIMIT = 4 * 1024 * 1024;   // 4MB total (Vercel body limit 기준)

// ── 응답 타입 ─────────────────────────────────────────────────────────────────
export type FileUploadResult = {
  fileName:             string;
  companyCode:          string | null;
  sourceType:           string | null;
  confidence:           number;
  reasons:              string[];
  parsedCount:          number;
  insertedCount:        number;
  skippedDuplicateCount: number;
  errors:               string[];
  needsManual?:         boolean;
};

export type UploadApiResponse = {
  ok:              boolean;
  uploadSessionId: string | null;
  month:           string;
  files:           FileUploadResult[];
  summary: {
    totalFiles:              number;
    successFiles:            number;
    failedFiles:             number;
    bankTransactions:        number;
    cardTransactions:        number;
    hometaxInvoices:         number;
    cashflowEntriesCreated:  number;
    cashflowSkipped:         number;
    autoMatched:             number;
    manualReview:            number;
    unmatched:               number;
  };
  error?: string;
  rematchErrors?: string[];  // 재매칭 중 발생한 DB 오류 목록
};

// ── 핸들러 ───────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse<UploadApiResponse>> {
  const month = new Date().toISOString().slice(0, 7); // default
  const empty: UploadApiResponse = {
    ok: false, uploadSessionId: null, month,
    files: [], summary: { totalFiles: 0, successFiles: 0, failedFiles: 0, bankTransactions: 0, cardTransactions: 0, hometaxInvoices: 0, cashflowEntriesCreated: 0, cashflowSkipped: 0, autoMatched: 0, manualReview: 0, unmatched: 0 },
  };

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ ...empty, error: 'multipart 파싱 실패 — Content-Type: multipart/form-data 확인' }, { status: 400 });
  }

  const selectedMonth   = (formData.get('month')   as string) || month;
  const selectedCompany = (formData.get('company')  as string) || '';
  const fallbackCompany = VALID_COMPANIES.includes(selectedCompany as CompanyCode) ? selectedCompany as CompanyCode : null;

  const rawFiles = formData.getAll('files') as File[];
  if (rawFiles.length === 0) {
    return NextResponse.json({ ...empty, month: selectedMonth, error: '파일이 없습니다' }, { status: 400 });
  }
  if (rawFiles.length > MAX_FILES) {
    return NextResponse.json({ ...empty, month: selectedMonth, error: `파일은 최대 ${MAX_FILES}개까지 허용` }, { status: 400 });
  }

  // ── 전체 크기 사전 검사 (Vercel body limit) ────────────────────────────────
  const totalSize = rawFiles.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > TOTAL_SIZE_LIMIT) {
    return NextResponse.json(
      { ...empty, month: selectedMonth, error: `업로드 파일 총 크기 초과 (${(totalSize / 1024 / 1024).toFixed(1)}MB > 4MB). 파일을 나눠서 업로드하세요.` },
      { status: 400 },
    );
  }

  // ── 파일별 파싱 및 perFileGroups 구성 ────────────────────────────────────────
  const fileResults:  FileUploadResult[] = [];
  const perFileGroups: PerFileGroup[]    = [];
  const allBanks:     BankTransaction[]  = [];
  const allCards:     CardTransaction[]  = [];
  const allHts:       HometaxInvoice[]   = [];

  for (const file of rawFiles) {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      fileResults.push({ fileName: file.name, companyCode: null, sourceType: null, confidence: 0, reasons: [], parsedCount: 0, insertedCount: 0, skippedDuplicateCount: 0, errors: [`허용되지 않는 확장자: ${ext}`], needsManual: true });
      continue;
    }
    if (file.size > MAX_FILE_SIZE) {
      fileResults.push({ fileName: file.name, companyCode: null, sourceType: null, confidence: 0, reasons: [], parsedCount: 0, insertedCount: 0, skippedDuplicateCount: 0, errors: [`파일 크기 초과 (${(file.size / 1024 / 1024).toFixed(1)}MB > 4MB)`], needsManual: true });
      continue;
    }

    const arrayBuf = await file.arrayBuffer();
    const buffer   = Buffer.from(arrayBuf);

    const parsed = parseUploadedFile(buffer, file.name, fallbackCompany, null);

    fileResults.push({
      fileName:              file.name,
      companyCode:           parsed.companyCode,
      sourceType:            parsed.sourceType,
      confidence:            parsed.confidence,
      reasons:               parsed.reasons,
      parsedCount:           parsed.parsedCount,
      insertedCount:         0,
      skippedDuplicateCount: 0,
      errors:                parsed.errors.map(e => e.message),
      needsManual:           parsed.needsManual,
    });

    // needsManual이어도 source_files 기록은 남김 (parseErrors만 있는 경우 포함)
    perFileGroups.push({
      filename:           file.name,
      buffer,
      sourceType:         parsed.sourceType as SourceType | null,
      companyCode:        parsed.companyCode as CompanyCode | null,
      detectedSourceType: parsed.sourceType,
      banks:              !parsed.needsManual && parsed.bankTransactions ? parsed.bankTransactions : [],
      cards:              !parsed.needsManual && parsed.cardTransactions ? parsed.cardTransactions : [],
      hts:                !parsed.needsManual && parsed.hometaxInvoices  ? parsed.hometaxInvoices  : [],
      parseErrors:        parsed.errors,
    });

    if (!parsed.needsManual) {
      if (parsed.bankTransactions) allBanks.push(...parsed.bankTransactions);
      if (parsed.cardTransactions) allCards.push(...parsed.cardTransactions);
      if (parsed.hometaxInvoices)  allHts.push(...parsed.hometaxInvoices);
    }
  }

  // ── Supabase 원천 데이터 반영 (cashflow_entries는 rematch가 생성) ─────────────
  const label = `web_upload_${selectedMonth}_${Date.now()}`;
  let importResult = { sessionId: '', bankUpserted: 0, cardUpserted: 0, htUpserted: 0, cashflowCreated: 0, cashflowSkipped: 0, bankIdMap: {} as Record<string, string>, cardIdMap: {} as Record<string, string>, htIdMap: {} as Record<string, string>, errors: [] as string[] };

  if (perFileGroups.length > 0) {
    try {
      // cashflow_entries 생성은 rematch에서 담당하므로 빈 배열 전달
      importResult = await importUploadedResults(label, perFileGroups, []);
    } catch (e) {
      return NextResponse.json({ ...empty, month: selectedMonth, files: fileResults, error: `DB 반영 오류: ${e}` }, { status: 500 });
    }
  }

  // ── 영향 월별 rematch 실행 ──────────────────────────────────────────────────
  const affectedMonths = getAffectedMonths(allBanks, allCards, allHts);
  let autoMatched = 0, manualReview = 0, unmatchedCount = 0, cashflowCreated = 0;
  const rematchErrors: string[] = [];

  for (const m of affectedMonths) {
    try {
      const r = await runRematch(m);
      autoMatched    += r.autoMatched;
      manualReview   += r.manualReview;
      unmatchedCount += r.unmatched;
      cashflowCreated += r.createdCount;
      if (r.errors.length > 0) rematchErrors.push(...r.errors.map(e => `[${m}] ${e}`));
    } catch (e) {
      rematchErrors.push(`[${m}] rematch 실패: ${e}`);
    }
  }
  importResult.cashflowCreated = cashflowCreated;
  importResult.errors.push(...rematchErrors);

  const matchResult = { autoMatched, manualReview, unmatched: unmatchedCount };

  // ── 파일별 insertedCount 업데이트 ────────────────────────────────────────────
  let bankOffset = 0, cardOffset = 0, htOffset = 0;
  for (const fr of fileResults) {
    if (fr.needsManual || fr.errors.length > 0) continue;
    const original = fileResults.find(f => f === fr);
    if (!original) continue;

    // insertedCount ≈ parsedCount (upsert 기준; 정확한 신규/기존 구분은 추후 개선)
    original.insertedCount = original.parsedCount;
  }

  const successFiles = fileResults.filter(f => !f.needsManual && f.errors.length === 0).length;
  const failedFiles  = fileResults.length - successFiles;

  const response: UploadApiResponse = {
    ok:              failedFiles === 0 && importResult.errors.length === 0,
    uploadSessionId: importResult.sessionId || null,
    month:           selectedMonth,
    files:           fileResults,
    summary: {
      totalFiles:             fileResults.length,
      successFiles,
      failedFiles,
      bankTransactions:       allBanks.length,
      cardTransactions:       allCards.length,
      hometaxInvoices:        allHts.length,
      cashflowEntriesCreated: importResult.cashflowCreated,
      cashflowSkipped:        importResult.cashflowSkipped,
      autoMatched:            matchResult.autoMatched,
      manualReview:           matchResult.manualReview,
      unmatched:              matchResult.unmatched,
    },
    rematchErrors: importResult.errors.length > 0 ? importResult.errors : undefined,
  };

  return NextResponse.json(response);
}

// ── 유효 회사 목록 ────────────────────────────────────────────────────────────
const VALID_COMPANIES: CompanyCode[] = ['feedback', 'sangsaeng', 'shootmoon'];

// ── 업로드된 데이터에서 영향 받는 월 목록 추출 ──────────────────────────────
function getAffectedMonths(
  banks: BankTransaction[],
  cards: CardTransaction[],
  hts:   HometaxInvoice[],
): string[] {
  const months = new Set<string>();
  // 날짜가 "YYYY.MM.DD" 형식일 경우 점을 대시로 정규화해 "YYYY-MM"을 보장
  const toMonth = (d?: string) => d?.substring(0, 7).replace(/\./g, '-');
  for (const b of banks) {
    const m = toMonth(b.transactionDate);
    if (m && /^\d{4}-\d{2}$/.test(m)) months.add(m);
  }
  for (const c of cards) {
    const m = toMonth(c.usedAt) ?? toMonth(c.paymentDueDate);
    if (m && /^\d{4}-\d{2}$/.test(m)) months.add(m);
  }
  for (const h of hts) {
    const m = toMonth(h.writtenDate || h.issuedDate);
    if (m && /^\d{4}-\d{2}$/.test(m)) months.add(m);
  }
  return Array.from(months).sort();
}
