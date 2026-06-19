import { BankTransaction, CardTransaction, HometaxInvoice } from '../types';
import { FixedCostEntry, CashflowEntry }                    from '../../matching/matcherTypes';
import { MatchingEngine }                                    from '../../matching/engine';
import { createServerClient }                               from '../supabase/server';

async function loadFixedCostsFromDB(): Promise<FixedCostEntry[]> {
  const client = createServerClient();
  if (!client) return [];

  const { data, error } = await (client as any)
    .from('fixed_cost_rules')
    .select('*')
    .eq('is_active', true);

  if (error || !data) return [];

  return (data as any[]).map(r => ({
    id:           r.id             ?? '',
    paymentDayRaw: String(r.payment_day ?? ''),
    paymentDay:    Number(r.payment_day  ?? 0),
    category:      r.category      ?? '',
    vendorName:    r.vendor_name   ?? '',
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
}

export type UploadMatchingResult = {
  cashflowEntries: CashflowEntry[];
  autoMatched:     number;
  manualReview:    number;
  unmatched:       number;
  fixedCostsLoaded: number;
  errors:          string[];
};

export async function runUploadMatching(
  banks: BankTransaction[],
  cards: CardTransaction[],
  hts:   HometaxInvoice[],
): Promise<UploadMatchingResult> {
  const errors: string[] = [];

  let fixedCosts: FixedCostEntry[] = [];
  try {
    fixedCosts = await loadFixedCostsFromDB();
  } catch (e) {
    errors.push(`고정비 로드 실패: ${e}`);
  }

  const engine = new MatchingEngine(banks, cards, hts, fixedCosts);
  engine.run();

  const cf           = engine.cashflow;
  const autoMatched  = cf.filter(e => e.matchStatus === 'AUTO_MATCHED').length;
  const manualReview = cf.filter(e => e.matchStatus === 'MANUAL_REVIEW').length;
  const unmatched    = cf.filter(e => e.matchStatus === 'UNMATCHED').length;

  return {
    cashflowEntries:  cf,
    autoMatched,
    manualReview,
    unmatched,
    fixedCostsLoaded: fixedCosts.length,
    errors,
  };
}
