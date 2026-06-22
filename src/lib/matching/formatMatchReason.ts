const REASON_LABELS: Record<string, string> = {
  bank_deposit_unmatched:    '은행 입금 — 홈택스·고정비와 매칭되지 않음',
  bank_withdrawal_unmatched: '은행 출금 — 홈택스·고정비와 매칭되지 않음',
  hometax_unmatched:         '홈택스 매입계산서 — 은행·카드와 매칭되지 않음',
  hometax_sales_unmatched:   '홈택스 매출계산서 — 은행 입금과 매칭되지 않음',
  card_unmatched:            '카드 거래 — 홈택스와 매칭되지 않음',
};

/** match_reason 코드·문자열을 화면용 한국어로 변환 */
export function formatMatchReason(raw: string | null | undefined): string {
  if (!raw?.trim()) return '—';

  const trimmed = raw.trim();
  if (REASON_LABELS[trimmed]) return REASON_LABELS[trimmed];

  for (const [code, label] of Object.entries(REASON_LABELS)) {
    if (trimmed === code || trimmed.startsWith(`${code} `) || trimmed.startsWith(`${code},`)) {
      const rest = trimmed.slice(code.length).replace(/^[\s,:]+/, '');
      return rest ? `${label} · ${rest}` : label;
    }
  }

  return trimmed;
}
