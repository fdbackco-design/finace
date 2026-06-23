export type VendorAlias = {
  id:                  string;
  vendor_id:           string;
  vendor_name:         string;  // from vendors.vendor_name (joined)
  representative_name: string | null; // from vendors.representative_name (joined)
  source_name:         string | null;
  business_number:     string | null;
};

export type MappingResult = {
  vendor_id:   string;
  vendor_name: string;
  basis:       'BUSINESS_NUMBER' | 'SOURCE_NAME' | 'REPRESENTATIVE_NAME';
} | null;

// 사업자번호 정규화: 숫자만 추출하여 10자리 비교
function normalizeBizNo(s: string): string {
  return s.replace(/\D/g, '');
}

export function applyVendorMapping(
  vendorName:     string,
  businessNumber: string | null | undefined,
  aliases:        VendorAlias[],
): MappingResult {
  // 1순위: 사업자번호 완전 일치
  if (businessNumber) {
    const norm = normalizeBizNo(businessNumber);
    const match = aliases.find(
      a => a.business_number && normalizeBizNo(a.business_number) === norm
    );
    if (match) {
      return { vendor_id: match.vendor_id, vendor_name: match.vendor_name, basis: 'BUSINESS_NUMBER' };
    }
  }
  // 2순위: 원본 사업자명 완전 일치
  const match = aliases.find(a => a.source_name === vendorName);
  if (match) {
    return { vendor_id: match.vendor_id, vendor_name: match.vendor_name, basis: 'SOURCE_NAME' };
  }
  // 3순위: 대표자명 완전 일치 (이체 시 대표자명으로 입금되는 경우)
  const repMatch = aliases.find(a => a.representative_name && a.representative_name === vendorName);
  if (repMatch) {
    return { vendor_id: repMatch.vendor_id, vendor_name: repMatch.vendor_name, basis: 'REPRESENTATIVE_NAME' };
  }
  return null;
}
