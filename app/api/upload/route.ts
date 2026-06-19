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
import { runUploadMatching }          from '@/src/lib/upload/runUploadMatching';
import { importUploadedResults }      from '@/src/lib/upload/importUploadedResults';
import type { BankTransaction, CardTransaction, HometaxInvoice } from '@/src/lib/types';

export const dynamic    = 'force-dynamic';
export const maxDuration = 60; // Vercel Pro 최대 60s

// ── 허용 확장자 ──────────────────────────────────────────────────────────────
const ALLOWED_EXT = ['.xlsx', '.xls', '.csv'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 20;

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

  // ── 파일별 처리 ─────────────────────────────────────────────────────────────
  const fileResults:  FileUploadResult[]  = [];
  const allBanks:     BankTransaction[]   = [];
  const allCards:     CardTransaction[]   = [];
  const allHts:       HometaxInvoice[]    = [];

  for (const file of rawFiles) {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      fileResults.push({ fileName: file.name, companyCode: null, sourceType: null, confidence: 0, reasons: [], parsedCount: 0, insertedCount: 0, skippedDuplicateCount: 0, errors: [`허용되지 않는 확장자: ${ext}`], needsManual: true });
      continue;
    }
    if (file.size > MAX_FILE_SIZE) {
      fileResults.push({ fileName: file.name, companyCode: null, sourceType: null, confidence: 0, reasons: [], parsedCount: 0, insertedCount: 0, skippedDuplicateCount: 0, errors: [`파일 크기 초과 (${(file.size / 1024 / 1024).toFixed(1)}MB > 10MB)`], needsManual: true });
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
      insertedCount:         0,  // will be updated after DB
      skippedDuplicateCount: 0,
      errors:                parsed.errors.map(e => e.message),
      needsManual:           parsed.needsManual,
    });

    if (!parsed.needsManual) {
      if (parsed.bankTransactions) allBanks.push(...parsed.bankTransactions);
      if (parsed.cardTransactions) allCards.push(...parsed.cardTransactions);
      if (parsed.hometaxInvoices)  allHts.push(...parsed.hometaxInvoices);
    }
  }

  // ── 매칭 실행 ────────────────────────────────────────────────────────────────
  let matchResult = { cashflowEntries: [] as any[], autoMatched: 0, manualReview: 0, unmatched: 0, fixedCostsLoaded: 0, errors: [] as string[] };
  if (allBanks.length + allCards.length + allHts.length > 0) {
    try {
      matchResult = await runUploadMatching(allBanks, allCards, allHts);
    } catch (e) {
      return NextResponse.json({ ...empty, month: selectedMonth, files: fileResults, error: `매칭 엔진 오류: ${e}` }, { status: 500 });
    }
  }

  // ── Supabase 반영 ────────────────────────────────────────────────────────────
  const label = `web_upload_${selectedMonth}_${Date.now()}`;
  let importResult = { sessionId: '', bankUpserted: 0, cardUpserted: 0, htUpserted: 0, cashflowCreated: 0, cashflowSkipped: 0, bankIdMap: {}, cardIdMap: {}, htIdMap: {}, errors: [] as string[] };

  if (allBanks.length + allCards.length + allHts.length > 0) {
    try {
      importResult = await importUploadedResults(label, allBanks, allCards, allHts, matchResult.cashflowEntries);
    } catch (e) {
      return NextResponse.json({ ...empty, month: selectedMonth, files: fileResults, error: `DB 반영 오류: ${e}` }, { status: 500 });
    }
  }

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
  };

  return NextResponse.json(response);
}

// ── 유효 회사 목록 ────────────────────────────────────────────────────────────
const VALID_COMPANIES: CompanyCode[] = ['feedback', 'sangsaeng', 'shootmoon'];
