// Korean string normalization: remove spaces, brackets, corp suffixes
export function normalize(s: string): string {
  return String(s ?? '')
    .replace(/[\s()\[\]（）【】㈜주식회사(주)]/g, '')
    .toLowerCase();
}

// Naive vendor similarity: exact > contains > token overlap
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  // 2-gram overlap
  const bigrams = (s: string) => {
    const g = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
    return g;
  };
  const ga = bigrams(na), gb = bigrams(nb);
  const intersect = [...ga].filter(g => gb.has(g)).length;
  const union = new Set([...ga, ...gb]).size;
  return union === 0 ? 0 : intersect / union;
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.abs((da - db) / (1000 * 60 * 60 * 24));
}

// Extract numeric digits only (for account number comparison)
export function digitsOnly(s: string): string {
  return String(s ?? '').replace(/\D/g, '');
}

// Check if two account-number-like strings overlap
export function acctNumMatch(a: string, b: string): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db || da.length < 8 || db.length < 8) return false;
  return da.includes(db) || db.includes(da);
}

// Split 고정비 F열 matchKey into tokens
export function fKeyTokens(matchKey: string): string[] {
  return matchKey
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length >= 3 && !t.includes('@')); // skip emails, very short tokens
}

// Check if any F열 token appears in bank fields
export function fKeyMatchesBank(
  fKey: string,
  vendorAlias: string,
  accountNoStr: string,
  bankDescription: string,
  bankCounterName: string,
  bankCounterAcctNo: string
): { matched: boolean; reason: string } {
  const bankDesc = normalize(bankDescription);
  const bankName = normalize(bankCounterName);
  const bankAcct = digitsOnly(bankCounterAcctNo);

  // K열 account number match
  const acctDigits = digitsOnly(accountNoStr);
  if (acctDigits.length >= 8 && bankAcct.length >= 8) {
    if (acctDigits.includes(bankAcct) || bankAcct.includes(acctDigits)) {
      return { matched: true, reason: `계좌번호 일치 (${bankCounterAcctNo})` };
    }
  }

  // E열 업체명 match
  const alias = normalize(vendorAlias);
  if (alias.length >= 2 && (bankDesc.includes(alias) || bankName.includes(alias))) {
    return { matched: true, reason: `업체명 포함 (${vendorAlias})` };
  }

  // F열 token match
  const tokens = fKeyTokens(fKey);
  for (const token of tokens) {
    const nt = normalize(token);
    if (!nt || nt.length < 2) continue;

    if (bankDesc.includes(nt) || bankName.includes(nt)) {
      return { matched: true, reason: `F열 키 일치 (${token})` };
    }
    // Phone number or biz-no in token → check containment
    const tokenDigits = digitsOnly(token);
    if (tokenDigits.length >= 7 && bankAcct.length >= 7) {
      if (tokenDigits.includes(bankAcct) || bankAcct.includes(tokenDigits)) {
        return { matched: true, reason: `계좌/사업자번호 일치 (${token})` };
      }
    }
  }

  return { matched: false, reason: '' };
}

let _seq = 0;
export function makeId(prefix: string): string {
  return `${prefix}_${++_seq}`;
}
