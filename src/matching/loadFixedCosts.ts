import * as XLSX from 'xlsx';
import { FixedCostEntry } from './matcherTypes';
import { makeId } from './helpers';

const COMPANY_MAP: Record<string, string> = {
  '피드백': 'feedback',
  '상생':   'sangsaeng',
  '슛문':   'shootmoon',
};

function normalizeCompany(raw: string): string {
  if (!raw) return 'all';
  for (const [k, v] of Object.entries(COMPANY_MAP)) {
    if (raw.includes(k)) return v;
  }
  return 'all';
}

function parsePaymentDay(raw: string): number {
  if (!raw) return 0;
  const s = String(raw).trim();
  if (s.includes('말일')) return 31;
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

export function loadFixedCosts(goalPath: string): FixedCostEntry[] {
  const buf = require('fs').readFileSync(goalPath);
  const wb  = XLSX.read(buf, { type: 'buffer', raw: false });
  const ws  = wb.Sheets['고정비캘린더'];
  if (!ws) throw new Error('goal.xlsx에 고정비캘린더 시트 없음');

  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

  const entries: FixedCostEntry[] = [];

  // Row 0 = 헤더, data from Row 1 (idx 1)
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i];
    // Skip if A(지급일)=null or '합계'
    if (!row[0] || String(row[0]).includes('합계')) continue;
    // Skip if C(내용) is empty
    if (!row[2]) continue;

    const payDayRaw = String(row[0]);
    const category  = String(row[1] ?? '');
    const vendorName = String(row[2] ?? '');
    const amount    = typeof row[3] === 'number' ? row[3] : 0;
    const vendorAlias = String(row[4] ?? '');
    const matchKey  = String(row[5] ?? '');
    const notes     = String(row[6] ?? '');
    const companyRaw = String(row[7] ?? '');
    const paymentType = String(row[9] ?? '');
    const accountNoStr = String(row[10] ?? '');
    const vatType   = String(row[11] ?? '');

    entries.push({
      id:           makeId('fc'),
      paymentDayRaw: payDayRaw,
      paymentDay:   parsePaymentDay(payDayRaw),
      category,
      vendorName,
      amount,
      vendorAlias,
      matchKey,
      notes,
      companyRaw,
      company:      normalizeCompany(companyRaw),
      paymentType,
      accountNoStr,
      vatType,
      isCardBill:   category === '카드',
    });
  }

  return entries;
}
