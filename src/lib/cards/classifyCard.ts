export type CardCompanyName = '상생' | '피드백';
export type CardProvider    = '우리카드' | '기업카드';
export type CardLabel       = '상생 우리카드' | '상생 기업카드' | '피드백 우리카드' | '피드백 기업카드';

export type CardClassification = {
  companyName: CardCompanyName;
  cardProvider: CardProvider;
  cardLabel: CardLabel;
};

// 카드번호에서 마지막 세그먼트(하이픈·공백 구분)의 숫자만 추출
function lastDigitSegment(cardStr: string): string {
  const segs = cardStr.trim().split(/[\-\s]+/);
  return segs[segs.length - 1].replace(/\D/g, '');
}

/**
 * 카드 거래를 회사·카드사·카드 라벨로 분류한다.
 *
 * CARD_WOORI: cardRef(이용카드 식별값)에 '9727' → 피드백, '6313' → 상생
 * CARD_IBK  : cardNo 마지막 4자리 '6904' → 피드백, '7979'·'7969' → 상생
 * 분류 불가 시 null 반환 (임의 배정 금지).
 */
export function classifyCard(input: {
  source: 'CARD_IBK' | 'CARD_WOORI';
  cardNo?:  string | null;
  cardRef?: string | null;
}): CardClassification | null {
  if (input.source === 'CARD_WOORI') {
    const ref = String(input.cardRef ?? input.cardNo ?? '');
    if (ref.includes('9727')) return { companyName: '피드백', cardProvider: '우리카드', cardLabel: '피드백 우리카드' };
    if (ref.includes('6313')) return { companyName: '상생',   cardProvider: '우리카드', cardLabel: '상생 우리카드'   };
    return null;
  }

  if (input.source === 'CARD_IBK') {
    const last4 = lastDigitSegment(String(input.cardNo ?? ''));
    if (last4 === '6904') return { companyName: '피드백', cardProvider: '기업카드', cardLabel: '피드백 기업카드' };
    if (last4 === '7979') return { companyName: '상생',   cardProvider: '기업카드', cardLabel: '상생 기업카드'   };
    if (last4 === '7969') return { companyName: '상생',   cardProvider: '기업카드', cardLabel: '상생 기업카드'   };
    return null;
  }

  return null;
}

// company_code + source_type → CardLabel (cashflow_entries 기반 역매핑)
const CF_CARD_LABEL: Record<string, CardLabel> = {
  'sangsaeng:CARD_WOORI': '상생 우리카드',
  'sangsaeng:CARD_IBK':   '상생 기업카드',
  'feedback:CARD_WOORI':  '피드백 우리카드',
  'feedback:CARD_IBK':    '피드백 기업카드',
};

export function cardLabelFromEntry(companyCode: string, sourceType: string): CardLabel | null {
  return CF_CARD_LABEL[`${companyCode}:${sourceType}`] ?? null;
}

// 표시 순서 (작을수록 위)
const CARD_LABEL_ORDER: Record<CardLabel, number> = {
  '상생 우리카드':  0,
  '상생 기업카드':  1,
  '피드백 우리카드': 2,
  '피드백 기업카드': 3,
};

export function cardLabelSortOrder(label: CardLabel): number {
  return CARD_LABEL_ORDER[label] ?? 99;
}
