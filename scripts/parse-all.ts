import * as fs   from 'fs';
import * as path from 'path';

import { parseBankIbk }            from '../src/parsers/parseBankIbk';
import { parseBankWoori }          from '../src/parsers/parseBankWoori';
import { parseCardIbk }            from '../src/parsers/parseCardIbk';
import { parseCardWoori }          from '../src/parsers/parseCardWoori';
import { parseHometaxPurchaseTax } from '../src/parsers/parseHometaxPurchaseTax';
import { parseHometaxPurchase }    from '../src/parsers/parseHometaxPurchase';
import { parseHometaxSalesTax }    from '../src/parsers/parseHometaxSalesTax';

import {
  BankTransaction, CardTransaction, HometaxInvoice,
  CompanyCode, ParseError,
} from '../src/lib/types';

const BASE_DIR   = path.resolve(__dirname, '..');
const ASSET_DIR  = path.join(BASE_DIR, 'asset');
const PARSED_DIR = path.join(BASE_DIR, 'parsed');

// Card WOORI payment days by company
const WOORI_PAY_DAY: Record<string, number> = {
  feedback:  20,
  sangsaeng: 17,
};

interface FileConfig {
  file:    string;
  company: CompanyCode;
  type:    string;
}

const FILES: FileConfig[] = [
  // ── 피드백 ──────────────────────────────────────────────────────
  { file: 'feedback/거래내역조회_입출식 예금20260619.xlsx', company: 'feedback',  type: 'BANK_IBK'       },
  { file: 'feedback/매입전자세금계산서목록(1~16).xls',      company: 'feedback',  type: 'HT_PURCHASE_TAX' },
  { file: 'feedback/매입전자계산서목록(1~1).xls',           company: 'feedback',  type: 'HT_PURCHASE'    },
  { file: 'feedback/매출전자세금계산서목록(1~1).xls',       company: 'feedback',  type: 'HT_SALES_TAX'   },
  { file: 'feedback/피드백기업카드(13일부터12일까지).xlsx',  company: 'feedback',  type: 'CARD_IBK'       },
  { file: 'feedback/피드백우리카드(6일부터5일까지).xls',    company: 'feedback',  type: 'CARD_WOORI'     },
  // ── 상생 ──────────────────────────────────────────────────────
  { file: 'sangsaeng/거래내역조회_입출식 예금20260619.xlsx', company: 'sangsaeng', type: 'BANK_IBK'       },
  { file: 'sangsaeng/우리은행 거래내역조회 20260619.xlsx',   company: 'sangsaeng', type: 'BANK_WOORI'     },
  { file: 'sangsaeng/매입전자세금계산서목록(1~11).xls',     company: 'sangsaeng', type: 'HT_PURCHASE_TAX' },
  { file: 'sangsaeng/매출전자세금계산서목록(1~2).xls',      company: 'sangsaeng', type: 'HT_SALES_TAX'   },
  { file: 'sangsaeng/상생기업카드(3일부터2일까지).xlsx',    company: 'sangsaeng', type: 'CARD_IBK'       },
  { file: 'sangsaeng/상생우리카드(3일부터2일까지).xls',     company: 'sangsaeng', type: 'CARD_WOORI'     },
  // ── 슛문 ──────────────────────────────────────────────────────
  { file: 'shootmoon/매입전자세금계산서목록(1~3).xls',      company: 'shootmoon', type: 'HT_PURCHASE_TAX' },
  { file: 'shootmoon/매입전자계산서목록(1~1).xls',          company: 'shootmoon', type: 'HT_PURCHASE'    },
];

// ─────────────────────────────────────────────────────────────────

interface AnyError extends ParseError { type: string }

function main() {
  if (!fs.existsSync(PARSED_DIR)) fs.mkdirSync(PARSED_DIR, { recursive: true });

  const allBank:   BankTransaction[]  = [];
  const allCard:   CardTransaction[]  = [];
  const allHT:     HometaxInvoice[]   = [];
  const allErrors: AnyError[]         = [];

  let ok = 0, fail = 0;

  for (const fc of FILES) {
    const fullPath = path.join(ASSET_DIR, fc.file);
    const label    = `[${fc.company}] ${fc.type}`;
    process.stdout.write(`  ${label}: ${path.basename(fc.file)} … `);

    try {
      const buf = fs.readFileSync(fullPath);
      let recs: (BankTransaction | CardTransaction | HometaxInvoice)[];
      let errs: ParseError[];

      switch (fc.type) {
        case 'BANK_IBK': {
          const r = parseBankIbk(buf, fc.company, fc.file);
          recs = r.records; errs = r.errors;
          allBank.push(...r.records as BankTransaction[]);
          break;
        }
        case 'BANK_WOORI': {
          const r = parseBankWoori(buf, fc.company, fc.file);
          recs = r.records; errs = r.errors;
          allBank.push(...r.records as BankTransaction[]);
          break;
        }
        case 'CARD_IBK': {
          const r = parseCardIbk(buf, fc.company, fc.file);
          recs = r.records; errs = r.errors;
          allCard.push(...r.records as CardTransaction[]);
          break;
        }
        case 'CARD_WOORI': {
          const r = parseCardWoori(buf, fc.company, fc.file, WOORI_PAY_DAY[fc.company] ?? 20);
          recs = r.records; errs = r.errors;
          allCard.push(...r.records as CardTransaction[]);
          break;
        }
        case 'HT_PURCHASE_TAX': {
          const r = parseHometaxPurchaseTax(buf, fc.company, fc.file);
          recs = r.records; errs = r.errors;
          allHT.push(...r.records as HometaxInvoice[]);
          break;
        }
        case 'HT_PURCHASE': {
          const r = parseHometaxPurchase(buf, fc.company, fc.file);
          recs = r.records; errs = r.errors;
          allHT.push(...r.records as HometaxInvoice[]);
          break;
        }
        case 'HT_SALES_TAX': {
          const r = parseHometaxSalesTax(buf, fc.company, fc.file);
          recs = r.records; errs = r.errors;
          allHT.push(...r.records as HometaxInvoice[]);
          break;
        }
        default:
          throw new Error(`Unknown type: ${fc.type}`);
      }

      console.log(`✅ ${recs.length}건${errs.length ? `  ⚠ 오류 ${errs.length}건` : ''}`);
      errs.forEach(e => allErrors.push({ ...e, type: fc.type }));
      ok++;
    } catch (e) {
      console.log(`❌ ${e}`);
      allErrors.push({ file: fc.file, type: fc.type, rowIndex: -1, message: String(e), rawData: [] });
      fail++;
    }
  }

  // ── Write output files ──────────────────────────────────────────
  const write = (name: string, data: unknown) =>
    fs.writeFileSync(path.join(PARSED_DIR, name), JSON.stringify(data, null, 2), 'utf-8');

  write('bank-transactions.json', allBank);
  write('card-transactions.json', allCard);
  write('hometax-invoices.json',  allHT);
  write('parse-errors.json',      allErrors);

  // ── Summary ─────────────────────────────────────────────────────
  const provisional = allBank.filter(t => t.categoryHint === '가수금').length;
  const cancelled   = allCard.filter(t => t.isCancelled).length;
  const htPurchase  = allHT.filter(t => t.invoiceDirection === 'purchase').length;
  const htSales     = allHT.filter(t => t.invoiceDirection === 'sales').length;

  const byCompany = (arr: { company: string }[]) =>
    ['feedback', 'sangsaeng', 'shootmoon'].map(c => `${c}: ${arr.filter(x => x.company === c).length}건`).join(', ');

  const now = new Date().toISOString().split('T')[0];
  const md  = [
    `# 파싱 결과 요약 — ${now}`,
    '',
    '## 파일 처리 현황',
    `| | |`,
    `|---|---|`,
    `| 전체 파일 | ${FILES.length}개 |`,
    `| 성공 | ${ok}개 |`,
    `| 실패 | ${fail}개 |`,
    '',
    '## 레코드 건수',
    `| 타입 | 건수 |`,
    `|------|------|`,
    `| 은행 거래 (BANK_IBK + BANK_WOORI) | ${allBank.length} |`,
    `| 카드 거래 (CARD_IBK + CARD_WOORI) | ${allCard.length} |`,
    `| 홈텍스 계산서 | ${allHT.length} |`,
    `| **합계** | **${allBank.length + allCard.length + allHT.length}** |`,
    '',
    '## 회사별',
    `- 은행: ${byCompany(allBank)}`,
    `- 카드: ${byCompany(allCard)}`,
    `- 홈텍스: ${byCompany(allHT)}`,
    '',
    '## 세부 내역',
    `- 카드 취소건: ${cancelled}건`,
    `- 홈텍스 매입: ${htPurchase}건 / 매출: ${htSales}건`,
    `- 가수금 감지 (피드백 BANK_IBK): ${provisional}건`,
    '',
    '## 파싱 오류',
    allErrors.length === 0
      ? '없음 ✅'
      : allErrors.map(e => `- **[${e.type}]** ${e.file} Row ${e.rowIndex}: ${e.message}`).join('\n'),
  ].join('\n');

  fs.writeFileSync(path.join(PARSED_DIR, 'parse-summary.md'), md, 'utf-8');

  console.log('\n' + '─'.repeat(56));
  console.log(md);
  console.log('─'.repeat(56));
  console.log(`\n✅ 출력 위치: ${PARSED_DIR}/`);
}

main();
