/**
 * autoClassify.ts
 *
 * 세금계산서 거래처명, 품목명, 고정비 캘린더, 카드사용처 규칙 기반
 * display_category 자동 추천 로직.
 *
 * 우선순위:
 *   1. 고정비 캘린더 (fixed_cost_rules) vendor_name 또는 vendor_alias 일치
 *   2. vendor_name 키워드 패턴
 *   3. category + sub_category 기반 기본 매핑
 */

export type ClassifyResult = {
  categoryAuto: string | null;
  basis: string;
};

interface FixedCostHint {
  category: string;
  vendorName: string;
  vendorAlias: string | null;
}

// 고정비 규칙 기반 분류
export function classifyByFixedCost(
  vendorName: string,
  fixedCostRules: FixedCostHint[],
): ClassifyResult | null {
  const norm = vendorName.trim().toLowerCase();
  for (const fc of fixedCostRules) {
    const alias = fc.vendorAlias?.trim().toLowerCase();
    const name  = fc.vendorName.trim().toLowerCase();
    if ((alias && norm.includes(alias)) || norm.includes(name)) {
      return { categoryAuto: fc.category, basis: '고정비 캘린더 매칭' };
    }
  }
  return null;
}

// 거래처명 키워드 기반 분류
const KEYWORD_RULES: { keywords: string[]; category: string }[] = [
  { keywords: ['손성훈'],                 category: '임차료(손성훈)' },
  { keywords: ['신진혁'],                 category: '임차료(신진혁)' },
  { keywords: ['이명진'],                 category: '임차료(이명진)' },
  { keywords: ['임차', '임대', '보증금'], category: '임차료' },
  { keywords: ['관리비', '관리단'],       category: '관리비' },
  { keywords: ['주차'],                   category: '정기주차권' },
  { keywords: ['리스'],                   category: '리스료' },
  { keywords: ['렌트', '렌탈'],           category: '렌트료' },
  { keywords: ['세무', '기장'],           category: '기장료' },
  { keywords: ['sk브로드', 'lg유플', 'kt ', 'kts', '통신', '인터넷'], category: '통신비' },
  { keywords: ['이자', '대출이자', '금리'], category: '이자' },
  { keywords: ['보험', '건강보험공단'],   category: '4대보험' },
  { keywords: ['급여'],                   category: '급여' },
  { keywords: ['원천세', '세무서'],       category: '원천세' },
  { keywords: ['구글', 'chatgpt', 'openai', 'adobe', 'slack', '구독'], category: '지급수수료' },
  { keywords: ['식대', '쉐프', '복리'],   category: '복리후생비' },
  { keywords: ['쿠쿠', '정수기'],         category: '렌탈료' },
];

export function classifyByKeyword(vendorName: string, itemName?: string): ClassifyResult | null {
  const text = `${vendorName} ${itemName ?? ''}`.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some(k => text.includes(k.toLowerCase()))) {
      return { categoryAuto: rule.category, basis: '거래처명 키워드' };
    }
  }
  return null;
}

// category/subCategory 기반 기본 매핑
const CATEGORY_MAP: Record<string, string | null> = {
  '매입':     '외상매입금',
  '매출':     null,
  '가수금':   null,
  '카드지출': null,
  '카드결제': null,
  '급여':     '급여',
  '이자':     '이자',
  '고정비':   null, // subCategory로 판단
};

const SUBCATEGORY_MAP: Record<string, string> = {
  '임차료':   '임차료',
  '지급수수료': '지급수수료',
  '관리비':   '관리비',
  '통신비':   '통신비',
  '복리후생비': '복리후생비',
  '복리후생': '복리후생비',
  '이자비용': '이자',
  '렌트료':   '렌트료',
  '렌탈':     '렌탈료',
  '리스':     '리스료',
  '주차':     '정기주차권',
  '기장료':   '기장료',
  '원천세':   '원천세',
  '4대보험':  '4대보험',
  '급여':     '급여',
};

export function classifyByCategory(
  category: string,
  subCategory: string | null,
  vendorName: string,
): ClassifyResult | null {
  // sub_category 매핑
  if (subCategory) {
    const norm = subCategory.trim();
    for (const [key, val] of Object.entries(SUBCATEGORY_MAP)) {
      if (norm.includes(key)) return { categoryAuto: val, basis: 'sub_category 매핑' };
    }
  }

  // vendor_name에 sub 힌트 포함 여부
  for (const [key, val] of Object.entries(SUBCATEGORY_MAP)) {
    if (vendorName.includes(key)) return { categoryAuto: val, basis: '거래처명 패턴' };
  }

  // category 기본 매핑
  const mapped = CATEGORY_MAP[category];
  if (mapped !== undefined) return { categoryAuto: mapped, basis: 'category 기본 매핑' };

  return null;
}

/**
 * 종합 자동 분류
 * @returns categoryAuto (null이면 분류 불가), basis (근거 설명)
 */
export function autoClassify(
  vendorName: string,
  category: string,
  subCategory: string | null,
  fixedCostRules: FixedCostHint[],
  itemName?: string,
): ClassifyResult {
  return (
    classifyByFixedCost(vendorName, fixedCostRules) ??
    classifyByKeyword(vendorName, itemName) ??
    classifyByCategory(category, subCategory, vendorName) ??
    { categoryAuto: null, basis: '자동 분류 불가' }
  );
}
