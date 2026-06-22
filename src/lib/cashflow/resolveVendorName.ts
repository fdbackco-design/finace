/** 홈택스 계산서 조회용 (G열=vendor_name, 매출 시 거래처는 L열=customer_name) */
export type HtVendorRef = {
  source_type: string;
  vendor_name: string | null;
  customer_name: string | null;
};

export type CashflowVendorEntry = {
  vendor_name: string;
  vendor_name_mapped?: string | null;
  hometax_invoice_id?: string | null;
};

/** 매입 계산서 G열(공급자 상호). 매출은 거래처가 L열(공급받는자)이므로 customer_name 사용 */
export function hometaxTradeName(ht: HtVendorRef): string {
  if (ht.source_type === 'HT_SALES_TAX') {
    return ht.customer_name?.trim() ?? '';
  }
  return ht.vendor_name?.trim() ?? '';
}

/**
 * 자금수지현황표 거래처명 결정:
 *   1순위 — 홈택스 G열 상호 (매출은 L열 공급받는자 상호)
 *   2순위 — 고정비캘린더 E열 (vendor_alias), C열(vendor_name)로 매칭
 *   3순위 — vendor_name_mapped 또는 vendor_name
 */
export function resolveCashflowVendorName(
  entry: CashflowVendorEntry,
  htById: Map<string, HtVendorRef>,
  fcAliasByVendorName: Map<string, string>,
): string {
  if (entry.hometax_invoice_id) {
    const ht = htById.get(entry.hometax_invoice_id);
    if (ht) {
      const name = hometaxTradeName(ht);
      if (name) return name;
    }
  }

  const fcAlias = fcAliasByVendorName.get(entry.vendor_name.trim());
  if (fcAlias) return fcAlias;

  return entry.vendor_name_mapped?.trim() || entry.vendor_name;
}

/** fixed_cost_rules 목록 → C열(vendor_name) → E열(vendor_alias) 맵 */
export function buildFcAliasMap(
  rules: { vendor_name: string; vendor_alias: string | null }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rules) {
    const alias = r.vendor_alias?.trim();
    if (alias) map.set(r.vendor_name.trim(), alias);
  }
  return map;
}
