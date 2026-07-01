/**
 * Phase 2A Dry-Run 스크립트
 *
 * 최근 1개월 데이터에 대해 Phase 2A 투영을 dry-run 실행.
 * DB에는 아무것도 쓰지 않음 — 처리 건수와 에러만 보고.
 *
 * 실행:
 *   npx ts-node --project tsconfig.scripts.json scripts/phase2DryRun.ts [company] [YYYY-MM]
 *
 * 예시:
 *   npx ts-node --project tsconfig.scripts.json scripts/phase2DryRun.ts feedback 2026-06
 *   npx ts-node --project tsconfig.scripts.json scripts/phase2DryRun.ts              # 전체 회사 / 이번 달
 *
 * 출력: JSON 형식 보고서 (stdout)
 */

// tsconfig.scripts.json에는 path alias(@/)가 없으므로 상대 경로 사용
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수 누락');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const COMPANIES = ['feedback', 'sangsaeng', 'shootmoon'];

async function main() {
  const companyArg = process.argv[2] ?? null;
  const monthArg   = process.argv[3] ?? new Date().toISOString().slice(0, 7);

  const companies = companyArg ? [companyArg] : COMPANIES;

  // 기준 날짜: 해당 월 1일
  const fromDate = `${monthArg}-01`;
  // 다음 달 1일 직전까지
  const [y, m] = monthArg.split('-').map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

  const report: {
    runDate:      string;
    month:        string;
    companies:    Record<string, CompanyDryRunResult>;
    totals:       DryRunTotals;
    errors:       string[];
  } = {
    runDate:   new Date().toISOString(),
    month:     monthArg,
    companies: {},
    totals:    { bankNT: 0, cardNT: 0, htNT: 0, cashEvents: 0, htObligations: 0, cardGroupObligations: 0, fixedCostObligations: 0, proposedAllocations: 0, autoConfirmed: 0, overdueItems: 0 },
    errors:    [],
  };

  for (const companyCode of companies) {
    try {
      const result = await dryRunCompany(companyCode, fromDate, nextMonth, monthArg);
      report.companies[companyCode] = result;
      report.totals.bankNT                += result.nt.bank;
      report.totals.cardNT                += result.nt.card;
      report.totals.htNT                  += result.nt.ht;
      report.totals.cashEvents            += result.cashEvents;
      report.totals.htObligations         += result.obligations.ht;
      report.totals.cardGroupObligations  += result.obligations.cardGroup;
      report.totals.fixedCostObligations  += result.obligations.fixedCost;
      report.totals.proposedAllocations   += result.allocations.proposed;
      report.totals.autoConfirmed         += result.allocations.autoConfirmed;
      report.totals.overdueItems          += result.overdue;
      report.errors.push(...result.errors.map(e => `[${companyCode}] ${e}`));
    } catch (e) {
      report.errors.push(`[${companyCode}] DryRun 실패: ${e}`);
    }
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.errors.length > 0 ? 1 : 0);
}

interface DryRunTotals {
  bankNT: number; cardNT: number; htNT: number;
  cashEvents: number;
  htObligations: number; cardGroupObligations: number; fixedCostObligations: number;
  proposedAllocations: number; autoConfirmed: number;
  overdueItems: number;
}

interface CompanyDryRunResult {
  companyId:    string;
  nt:           { bank: number; card: number; ht: number };
  cashEvents:   number;
  obligations:  { ht: number; cardGroup: number; fixedCost: number };
  allocations:  { proposed: number; autoConfirmed: number; reviewItems: number };
  overdue:      number;
  errors:       string[];
}

async function dryRunCompany(
  companyCode: string,
  fromDate:    string,
  toDate:      string,
  month:       string,
): Promise<CompanyDryRunResult> {
  const errors: string[] = [];

  // company_id 조회
  const { data: co, error: coErr } = await supabase
    .from('companies')
    .select('id')
    .eq('company_code', companyCode)
    .single();

  if (coErr || !co) {
    return {
      companyId: '', nt: { bank: 0, card: 0, ht: 0 }, cashEvents: 0,
      obligations: { ht: 0, cardGroup: 0, fixedCost: 0 },
      allocations: { proposed: 0, autoConfirmed: 0, reviewItems: 0 },
      overdue: 0,
      errors: [`company '${companyCode}' 조회 실패: ${coErr?.message}`],
    };
  }
  const companyId = co.id as string;

  // ── 1. 미투영 은행 거래 건수 ─────────────────────────────────────────────────
  const [bankRes, cardRes, htRes] = await Promise.all([
    supabase
      .from('bank_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('transaction_date', fromDate)
      .lt('transaction_date', toDate),
    supabase
      .from('card_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('transaction_date', fromDate)
      .lt('transaction_date', toDate),
    supabase
      .from('hometax_invoices')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('issue_date', fromDate)
      .lt('issue_date', toDate),
  ]);

  if (bankRes.error) errors.push(`bank count: ${bankRes.error.message}`);
  if (cardRes.error) errors.push(`card count: ${cardRes.error.message}`);
  if (htRes.error)   errors.push(`ht count: ${htRes.error.message}`);

  // 이미 NT 있는 것 제외
  const [existBank, existCard, existHt] = await Promise.all([
    supabase.from('normalized_transactions').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).not('bank_transaction_id', 'is', null)
      .gte('event_date', fromDate).lt('event_date', toDate),
    supabase.from('normalized_transactions').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).not('card_transaction_id', 'is', null)
      .gte('event_date', fromDate).lt('event_date', toDate),
    supabase.from('normalized_transactions').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).not('hometax_invoice_id', 'is', null)
      .gte('event_date', fromDate).lt('event_date', toDate),
  ]);

  const newBankNT = Math.max(0, (bankRes.count ?? 0) - (existBank.count ?? 0));
  const newCardNT = Math.max(0, (cardRes.count ?? 0) - (existCard.count ?? 0));
  const newHtNT   = Math.max(0, (htRes.count   ?? 0) - (existHt.count   ?? 0));

  // ── 2. 미생성 cash_event 건수 ─────────────────────────────────────────────────
  const realizedNTRes = await supabase
    .from('normalized_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .in('event_type', ['REALIZED_INFLOW', 'REALIZED_OUTFLOW'])
    .gte('event_date', fromDate).lt('event_date', toDate);

  const existCERes = await supabase
    .from('cash_events')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('event_date', fromDate).lt('event_date', toDate);

  const newCashEvents = Math.max(0, (realizedNTRes.count ?? 0) - (existCERes.count ?? 0));

  // ── 3. 미생성 obligation 건수 ─────────────────────────────────────────────────
  const htOblRes = await supabase
    .from('normalized_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .not('hometax_invoice_id', 'is', null)
    .gte('event_date', fromDate).lt('event_date', toDate);

  const existHtOblRes = await supabase
    .from('obligations')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('origin_type', 'SOURCE_TRANSACTION')
    .gte('due_date', fromDate).lt('due_date', toDate);

  const newHtObligations = Math.max(0, (htOblRes.count ?? 0) - (existHtOblRes.count ?? 0));

  // 카드 그룹 의무 (due_date 기준)
  const existCardGrpRes = await supabase
    .from('obligations')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('origin_type', 'CARD_SETTLEMENT_GROUP')
    .gte('due_date', fromDate).lt('due_date', toDate);

  // 실제 그룹 수 계산은 복잡하므로 estimated (개별 카드 NT → 그룹 수 ≈ NT수/3)
  const newCardGroups = Math.max(0, Math.ceil(newCardNT / 3) - (existCardGrpRes.count ?? 0));

  // 고정비 의무
  const fixedCostRes = await supabase
    .from('fixed_cost_rules')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('is_active', true);

  const existFcRes = await supabase
    .from('obligations')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('origin_type', 'FIXED_COST_RULE')
    .eq('fixed_cost_month', month);

  const newFixedCost = Math.max(0, (fixedCostRes.count ?? 0) - (existFcRes.count ?? 0));

  // ── 4. 미배분 현금이벤트 건수 (allocation 제안 예상치) ─────────────────────────
  const unallocatedCERes = await supabase
    .from('v_cash_event_balance')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .in('cash_status', ['UNALLOCATED', 'PARTIALLY_ALLOCATED'])
    .gte('event_date', fromDate).lt('event_date', toDate);

  // ── 5. 연체 건수 ───────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const overdueRes = await supabase
    .from('v_obligation_balance')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .in('lifecycle_status', ['OPEN', 'PARTIALLY_SETTLED'])
    .not('due_date', 'is', null)
    .lt('due_date', today);

  return {
    companyId,
    nt: { bank: newBankNT, card: newCardNT, ht: newHtNT },
    cashEvents: newCashEvents,
    obligations: { ht: newHtObligations, cardGroup: newCardGroups, fixedCost: newFixedCost },
    allocations: {
      proposed:      unallocatedCERes.count ?? 0,
      autoConfirmed: 0,
      reviewItems:   0,
    },
    overdue: overdueRes.count ?? 0,
    errors,
  };
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
