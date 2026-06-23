import {
  cardLabelFromEntry,
  cardLabelSortOrder,
  type CardLabel,
} from '@/src/lib/cards/classifyCard';

// ── 타입 ─────────────────────────────────────────────────────────────────────

export type CardUsageRow = {
  label:       string;
  amount:      number;
  limit:       number;
  remaining:   number;
  companyCode: string;
};

export type BalanceAccountDef = {
  key:        string;
  label:      string;
  sourceType?: 'BANK_IBK' | 'BANK_WOORI';
  currency:   'KRW' | 'USD';
};

export type BalanceDisplayRow = {
  companyCode:  string;
  companyLabel: string;
  accountLabel: string;
  balance:      number | null;
  currency:     'KRW' | 'USD';
  showCompany:  boolean;
  rowSpan:      number;
};

type CardTx = {
  amount:        number;
  used_date:     string | null;
  card_label:    string | null;
  company_code:  string;
  source_type:   string;
  is_cancelled:  boolean;
};

type BankTx = {
  company_code:     string;
  source_type:      string;
  balance:          number | null;
  transaction_date: string;
  transaction_time: string | null;
};

const COMPANY_LABEL: Record<string, string> = {
  feedback:  '피드백',
  sangsaeng: '상생',
  shootmoon: '슛문',
};

const CARD_DISPLAY: Record<CardLabel, string> = {
  '피드백 우리카드':  '피드백 신용카드(우리)',
  '피드백 기업카드':  '피드백 신용카드(기업)',
  '상생 우리카드':    '상생 신용카드(우리)',
  '상생 기업카드':    '상생 신용카드(기업)',
};

const ALL_CARD_LABELS: CardLabel[] = [
  '피드백 우리카드',
  '피드백 기업카드',
  '상생 기업카드',
  '상생 우리카드',
];

/** 회사별 계좌 행 정의 (이미지 레이아웃 기준) */
export const COMPANY_ACCOUNTS: Record<string, BalanceAccountDef[]> = {
  feedback: [
    { key: 'ibk-krw', label: '기업(원화)', sourceType: 'BANK_IBK',   currency: 'KRW' },
    { key: 'ibk-fx',  label: '기업(외화)',                          currency: 'USD' },
    { key: 'woori',   label: '우리',     sourceType: 'BANK_WOORI', currency: 'KRW' },
  ],
  sangsaeng: [
    { key: 'ibk',     label: '기업', sourceType: 'BANK_IBK',   currency: 'KRW' },
    { key: 'woori',   label: '우리', sourceType: 'BANK_WOORI', currency: 'KRW' },
    { key: 'shinhan', label: '신한',                          currency: 'KRW' },
  ],
  shootmoon: [
    { key: 'hana', label: '하나', sourceType: 'BANK_IBK', currency: 'KRW' },
  ],
};

const COMPANY_ORDER = ['feedback', 'sangsaeng', 'shootmoon'] as const;

const CARD_LIMIT: Record<CardLabel, number> = {
  '피드백 기업카드':  5_000_000,
  '피드백 우리카드': 10_000_000,
  '상생 기업카드':   8_000_000,
  '상생 우리카드':  10_000_000,
};

const VALID_CARD_LABELS = new Set<string>(ALL_CARD_LABELS);

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

export function formatTodayKo(now = new Date()): { dateLabel: string; ampm: string } {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const y    = now.getFullYear();
  const m    = String(now.getMonth() + 1).padStart(2, '0');
  const d    = String(now.getDate()).padStart(2, '0');
  const wd   = days[now.getDay()];
  const ampm = now.getHours() < 12 ? '오전' : '오후';
  return { dateLabel: `${y}-${m}-${d} (${wd})`, ampm };
}

export function monthRangeToToday(now = new Date()): { from: string; to: string } {
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, '0');
  const d   = String(now.getDate()).padStart(2, '0');
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${d}` };
}

function resolveCardLabel(row: CardTx): CardLabel | null {
  if (row.card_label && VALID_CARD_LABELS.has(row.card_label)) {
    return row.card_label as CardLabel;
  }
  return cardLabelFromEntry(row.company_code, row.source_type);
}

/** 이번 달 1일 ~ 오늘 카드 사용액 (카드별) */
export function buildCardUsageRows(cards: CardTx[]): CardUsageRow[] {
  const totals = new Map<CardLabel, number>();

  for (const label of ALL_CARD_LABELS) {
    totals.set(label, 0);
  }

  for (const c of cards) {
    if (c.is_cancelled || c.amount <= 0) continue;
    const label = resolveCardLabel(c);
    if (!label) continue;
    totals.set(label, (totals.get(label) ?? 0) + c.amount);
  }

  return [...ALL_CARD_LABELS]
    .sort((a, b) => cardLabelSortOrder(a) - cardLabelSortOrder(b))
    .map(label => {
      const amount = totals.get(label) ?? 0;
      const limit  = CARD_LIMIT[label];
      return {
        label:       CARD_DISPLAY[label],
        amount,
        limit,
        remaining:   limit - amount,
        companyCode: label.startsWith('피드백') ? 'feedback' : 'sangsaeng',
      };
    });
}

/** 회사·은행종류별 최신 잔액 */
export function buildLatestBalanceMap(banks: BankTx[]): Map<string, number> {
  const map = new Map<string, { balance: number; sortKey: string }>();

  for (const b of banks) {
    if (b.balance == null) continue;
    const key     = `${b.company_code}:${b.source_type}`;
    const sortKey = `${b.transaction_date}T${b.transaction_time ?? '00:00:00'}`;
    const prev    = map.get(key);
    if (!prev || sortKey > prev.sortKey) {
      map.set(key, { balance: b.balance, sortKey });
    }
  }

  const result = new Map<string, number>();
  for (const [key, val] of map) {
    result.set(key, val.balance);
  }
  return result;
}

/** 잔액 표 행 (회사 셀 병합용 rowSpan 포함) */
export function buildBalanceRows(balanceMap: Map<string, number>): BalanceDisplayRow[] {
  const rows: BalanceDisplayRow[] = [];

  for (const companyCode of COMPANY_ORDER) {
    const accounts = COMPANY_ACCOUNTS[companyCode];
    if (!accounts) continue;

    const companyLabel = COMPANY_LABEL[companyCode] ?? companyCode;

    accounts.forEach((acct, i) => {
      let balance: number | null = null;
      if (acct.sourceType) {
        const v = balanceMap.get(`${companyCode}:${acct.sourceType}`);
        balance = v !== undefined ? v : null;
      }

      rows.push({
        companyCode,
        companyLabel,
        accountLabel: acct.label,
        balance,
        currency:     acct.currency,
        showCompany:  i === 0,
        rowSpan:      i === 0 ? accounts.length : 0,
      });
    });
  }

  return rows;
}

export function sumKrwBalances(rows: BalanceDisplayRow[]): number {
  return rows.reduce((s, r) => {
    if (r.currency === 'KRW' && r.balance != null) return s + r.balance;
    return s;
  }, 0);
}

export { COMPANY_LABEL };
