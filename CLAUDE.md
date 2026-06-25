# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **Next.js 16.2.9** (App Router), **React 19.2.7**
- **Supabase** (PostgreSQL + service_role key, RLS bypassed server-side)
- **Vercel** deployment

## Commands

```bash
npm run dev          # Next.js dev server
npm run build        # Production build (runs tsc + next build)
npm run lint         # ESLint

# Script runners (use tsconfig.scripts.json, not default tsconfig)
npm run parse        # Parse a local file: npx ts-node --project tsconfig.scripts.json scripts/parseFile.ts <file>
npm run match        # Run matching engine locally
npm run db:import    # Import parsed results to DB
npm run db:check     # Check DB state

# Card utility scripts
npm run card:classify
npm run card:settlement
```

There are no unit tests in this project.

## Architecture

### Upload pipeline

```
POST /api/upload
  → parseUploadedFile()       # detectFileType → route to correct parser
  → importUploadedResults()   # upsert bank/card/HT rows; SHA256 source_hash dedup
  → runRematch(month)         # per affected month: delete auto cashflow, re-run engine, insert new rows
```

### File detection (`src/lib/upload/detectFileType.ts`)

Detection order matters — **BANK_WOORI must be checked before BANK_IBK** because Woori's "출금금액"/"입금금액" (long form) contains IBK's "출금액"/"입금액" as a substring.

- Woori: `거래일자 + 입금금액 + 출금금액` OR `거래일시 + 입금금액 + 출금금액` OR `거래일자 + 거래후잔액`
- IBK: `거래일시 + 출금액 + 입금액` OR `거래일시 + 잔액`
- HT: detected from A5 cell title containing "목록조회"
- Company auto-detection: `extractAccountHolder()` reads "예금주명?:" from first 4 rows, regex handles both IBK ("예금주명:") and Woori ("예금주 : ") formats

### Matching engine (`src/matching/engine.ts`)

Step execution order:

1. `step1` — 가수금 (feedback only: 은행 입금 with '송해민' in description)
2. `step3` — HT 매입세금계산서 vs 은행 출금 (±60-day window)
3. `step4` — HT 매출세금계산서 vs 은행 입금
4. `step2` — 고정비 (FixedCostEntry list from Google Sheets)
5. `stepSalary` — 은행 출금 with '급여' in description/memo → AUTO_MATCHED, groups by "[회사명] 급여"
6. `step5` — 잔여 (카드 transactions → UNMATCHED cashflow entries)

**AUTO_MATCHED conditions** (step3/step4):
```
score = 0.5 + dateScore + vendorScore * 0.1
vendorHit = reason.includes('거래처유사') && !reason.includes('거래처미확인')
dupScores = candidates where score >= top.score - 0.05
allTied = all dupScores within 0.001 of top.score  // enables N:N identical tx matching
isAuto = score >= 0.75 && vendorHit && (dupScores.length === 1 || allTied)
```

### runRematch (`src/lib/upload/runRematch.ts`)

Key behaviors:
- Never deletes `USER_EDITED` or `USER_CONFIRMED` cashflow entries
- After `engine.run()`, does a **vendor upgrade pass**: promotes `MANUAL_REVIEW` → `AUTO_MATCHED` when the entry has both `bankTransactionId` + `hometaxInvoiceId`, reason contains "금액일치", and the vendor is in the registered vendors list (name inclusion match or business number match)
- Salary entries with `groupName` are upserted into `cashflow_groups` table keyed by `company||YYYY-MM||groupName`, then `group_id` is written to the cashflow row

**Declaration order in runRematch** (important — TypeScript strict mode):
```
engine.run()
→ htDbIdMap / bankDbIdMap / cardDbIdMap declarations
→ vendor upgrade try/catch  ← uses htDbIdMap; must come AFTER declarations
→ salary group upsert
→ deleteByFk
→ cfRows build + batch insert
```

### Database (Supabase PostgreSQL)

Three companies: `feedback`, `sangsaeng`, `shootmoon`

Seven source types: `BANK_IBK`, `BANK_WOORI`, `CARD_IBK`, `CARD_WOORI`, `HT_PURCHASE_TAX`, `HT_PURCHASE`, `HT_SALES_TAX`

Key tables: `companies`, `bank_transactions`, `card_transactions`, `hometax_invoices`, `cashflow_entries`, `cashflow_groups`, `vendors`, `vendor_aliases`

`cashflow_entries.payment_source_type` has a CHECK constraint — use `|| null` (not `?? null`) to convert empty string to null, otherwise the constraint fires.

`source_hash` (SHA256) prevents duplicate uploads — same file uploaded twice is a no-op upsert.

### Card settlement (`src/lib/cards/settlement.ts`)

`CARD_SETTLEMENT_CONFIG` is keyed by `"company:sourceType"` (e.g. `"feedback:CARD_WOORI"`). Defines `paymentDay`, `fromDay`, `toDay` to compute which billing cycle a card transaction belongs to and when it's due.

### Vendors / 거래처

`vendors` and `vendor_aliases` tables control `vendor_name_mapped` (display only). They are **not** used by the matching engine's score calculation — vendor matching uses raw names from parsed files. The post-engine vendor upgrade step in `runRematch` reads these tables to promote matching scores.

## Key Invariants

- `BANK_WOORI` detection must come before `BANK_IBK` in `detectFileType.ts`
- Woori dates may arrive as "YYYY.MM.DD" — `parseBankIbk.ts` normalizes dots to dashes; `getAffectedMonths` also validates with `/^\d{4}-\d{2}$/` before calling `runRematch`
- `export const dynamic = 'force-dynamic'` and `export const revalidate = 0` on all API routes
- `createServerClient()` uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) — never import in browser components
- The `vendors`/`vendor_aliases` tables are for display mapping only; matching engine reads raw transaction names
