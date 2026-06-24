import { BankTransaction, CardTransaction, HometaxInvoice, CompanyCode } from '../lib/types';
import { FixedCostEntry, CashflowEntry, MatchedPair, MatchStatus } from './matcherTypes';
import { similarity, daysBetween, fKeyMatchesBank, makeId } from './helpers';

// ─── ID tagged types ───────────────────────────────────────────────────────
export type TaggedBank   = BankTransaction  & { _id: string };
export type TaggedCard   = CardTransaction  & { _id: string };
export type TaggedHT     = HometaxInvoice   & { _id: string };

// ─── Scoring helper ────────────────────────────────────────────────────────
interface HtCandidate {
  bankId:  string;
  cardId:  string;
  score:   number;
  reason:  string;
  date:    string;
}

function scoreCandidate(
  htAmount: number,
  htVendor: string,
  htDate: string,
  candidateAmount: number,
  candidateVendorFields: string[],
  candidateDate: string,
  maxDateDiff = 7,
  requireVendorForDistant = false  // step3 bank(매입출금)만 true — 고정비 충돌 방지
): { score: number; reason: string } {
  const amountDiff = Math.abs(htAmount - candidateAmount);
  if (amountDiff > 10) return { score: 0, reason: '' }; // amount must match within ₩10

  const dateDiff = daysBetween(htDate, candidateDate);
  if (dateDiff > maxDateDiff) return { score: 0, reason: '' };

  // 날짜 점수: 1일 이내 0.4, 3일 이내 0.3, 7일 이내 0.2, 30일 이내 0.2, 그 이후 0.1
  const dateScore = dateDiff <= 1 ? 0.4
                  : dateDiff <= 3 ? 0.3
                  : dateDiff <= 30 ? 0.2
                  : 0.1;
  const vendorScore = Math.max(...candidateVendorFields.map(f => similarity(htVendor, f)));
  // 매입 은행출금에서만: 7일 초과 시 거래처 유사도 필요 → 급여출금이 먼 계산서에 소비되는 것 방지
  if (requireVendorForDistant && dateDiff > 7 && vendorScore < 0.3) return { score: 0, reason: '' };
  const score = 0.5 + dateScore + vendorScore * 0.1; // amount already matched → base 0.5

  const reason = [
    `금액일치(${htAmount.toLocaleString()}원)`,
    `날짜차이${Math.round(dateDiff)}일`,
    vendorScore > 0.3 ? `거래처유사(${(vendorScore * 100).toFixed(0)}%)` : '거래처미확인',
  ].join(', ');

  return { score, reason };
}

// ─── Main Engine ───────────────────────────────────────────────────────────
export class MatchingEngine {
  private banks:  TaggedBank[];
  private cards:  TaggedCard[];
  private hts:    TaggedHT[];
  private fcs:    FixedCostEntry[];

  private usedBankIds = new Set<string>();
  private usedCardIds = new Set<string>();
  private usedHtIds   = new Set<string>();

  public cashflow:  CashflowEntry[] = [];
  public matched:   MatchedPair[]   = [];

  constructor(
    banks: BankTransaction[],
    cards: CardTransaction[],
    hts:   HometaxInvoice[],
    fcs:   FixedCostEntry[]
  ) {
    this.banks = banks.map((b, i) => ({ ...b, _id: `bank_${i}` }));
    this.cards = cards.map((c, i) => ({ ...c, _id: `card_${i}` }));
    this.hts   = hts.map((h, i) => ({ ...h, _id: `ht_${i}` }));
    this.fcs   = fcs;
  }

  run() {
    this.step1_provisional();
    this.step3_htPurchase();   // HT first — so fixed cost doesn't consume same bank tx
    this.step4_htSales();
    this.step2_fixedCosts();   // Fixed cost enriches remaining unmatched bank withdrawals
    this.stepSalary();         // 급여 키워드 은행 출금 자동 그룹화
    this.step5_remaining();
  }

  private static readonly COMPANY_KO: Record<string, string> = {
    feedback: '피드백', sangsaeng: '상생', shootmoon: '슛문',
  };

  // ── 급여 자동 감지: 잔여 출금 중 description/counterAccountName/memo에 '급여' 포함 ──
  private stepSalary() {
    for (const b of this.banks) {
      if (this.usedBankIds.has(b._id)) continue;
      if (b.withdrawAmount <= 0) continue;

      const isSalary = [b.description, b.counterAccountName, b.memo]
        .some(s => s && s.includes('급여'));
      if (!isSalary) continue;

      this.usedBankIds.add(b._id);

      const companyLabel = MatchingEngine.COMPANY_KO[b.company] ?? b.company;
      const groupName    = `${companyLabel} 급여`;

      this.cashflow.push({
        id:                makeId('cf'),
        company:           b.company,
        date:              b.transactionDate,
        vendorName:        b.counterAccountName || b.description || '급여',
        category:          '급여',
        subCategory:       '급여',
        incomeAmount:      0,
        expenseAmount:     b.withdrawAmount,
        sourceType:        b.sourceType,
        paymentSourceType: b.sourceType,
        matchStatus:       'AUTO_MATCHED',
        matchReason:       '급여_keyword',
        hometaxInvoiceId:  '',
        bankTransactionId: b._id,
        cardTransactionId: '',
        fixedCostId:       '',
        groupName,
        showInCashflow:    true,
      });
    }
  }

  // ── Step 1: 가수금 (피드백 BANK_IBK 입금 중 송해민/손성훈) ──────────────
  private step1_provisional() {
    for (const b of this.banks) {
      if (b.categoryHint !== '가수금') continue;
      this.usedBankIds.add(b._id);

      const person = '송해민';
      this.cashflow.push({
        id:              makeId('cf'),
        company:         b.company,
        date:            b.transactionDate,
        vendorName:      person,
        category:        '가수금',
        subCategory:     '가수금',
        incomeAmount:    b.depositAmount,
        expenseAmount:   0,
        sourceType:      'BANK_IBK',
        paymentSourceType: 'BANK_IBK',
        matchStatus:     'AUTO_MATCHED',
        matchReason:     `가수금 자동감지 (description="${b.description}")`,
        hometaxInvoiceId: '',
        bankTransactionId: b._id,
        cardTransactionId: '',
        fixedCostId:     '',
      });
    }
  }

  // ── Step 2: 고정비캘린더 ↔ 은행 출금 ────────────────────────────────────
  private step2_fixedCosts() {
    for (const b of this.banks) {
      if (this.usedBankIds.has(b._id)) continue;
      if (b.withdrawAmount <= 0) continue;

      // Find best matching fixed cost entry
      let bestFc: FixedCostEntry | null = null;
      let bestReason = '';
      let bestScore = 0;

      for (const fc of this.fcs) {
        // Company check: 고정비 company 'all' matches any, else must match
        if (fc.company !== 'all' && fc.company !== b.company) continue;

        const { matched, reason } = fKeyMatchesBank(
          fc.matchKey,
          fc.vendorAlias,
          fc.accountNoStr,
          b.description,
          b.counterAccountName,
          b.counterAccountNo
        );
        if (!matched) continue;

        // 업체명/계좌번호가 일치하면 금액 무관하게 자동매칭 (score >= 0.9 → AUTO)
        // 금액까지 일치하면 신뢰도를 더 높임
        let score = 0.9;
        if (fc.amount > 0) {
          const diff = Math.abs(fc.amount - b.withdrawAmount) / fc.amount;
          if (diff < 0.01) score = 0.98;  // 금액 정확 일치
          else if (diff < 0.1) score = 0.93;  // 금액 근사
          // diff >= 10%: 업체/계좌 일치만으로 0.9 유지 (AUTO)
        }

        if (score > bestScore) {
          bestScore = score;
          bestFc = fc;
          bestReason = reason;
        }
      }

      if (!bestFc) continue;

      this.usedBankIds.add(b._id);
      const status: MatchStatus = bestScore >= 0.85 ? 'AUTO_MATCHED' : 'MANUAL_REVIEW';

      this.matched.push({
        id:               makeId('mp'),
        matchType:        'FIXED_COST-BANK',
        score:            bestScore,
        hometaxInvoiceId: '',
        bankTransactionId: b._id,
        cardTransactionId: '',
        fixedCostId:      bestFc.id,
        matchReason:      bestReason,
      });

      this.cashflow.push({
        id:              makeId('cf'),
        company:         b.company,
        date:            b.transactionDate,
        vendorName:      bestFc.vendorAlias || bestFc.vendorName,
        category:        bestFc.isCardBill ? '카드결제' : '고정비',
        subCategory:     bestFc.category,
        incomeAmount:    0,
        expenseAmount:   b.withdrawAmount,
        sourceType:      'BANK_IBK',
        paymentSourceType: 'BANK_IBK',
        matchStatus:     status,
        matchReason:     `고정비: ${bestReason}`,
        hometaxInvoiceId: '',
        bankTransactionId: b._id,
        cardTransactionId: '',
        fixedCostId:     bestFc.id,
      });
    }
  }

  // ── Step 3: HT 매입 ↔ 은행출금 or 카드 ─────────────────────────────────
  private step3_htPurchase() {
    const purchaseHts = this.hts.filter(
      h => (h.sourceType === 'HT_PURCHASE_TAX' || h.sourceType === 'HT_PURCHASE') &&
           !this.usedHtIds.has(h._id)
    );

    for (const ht of purchaseHts) {
      const candidates: HtCandidate[] = [];

      // Bank candidates (withdraw) — 매입계산서 지급은 수십일 후 이뤄질 수 있어 60일 윈도우 사용
      for (const b of this.banks) {
        if (this.usedBankIds.has(b._id)) continue;
        if (b.company !== ht.company) continue;
        if (b.withdrawAmount <= 0) continue;

        const r = scoreCandidate(
          ht.totalAmount, ht.vendorName, ht.issuedDate,
          b.withdrawAmount,
          [b.description, b.counterAccountName, b.counterAccountNo],
          b.transactionDate,
          60,   // 매입: 최대 60일
          true  // 7일 초과 시 거래처 유사도 필요 (급여 등 고정비 보호)
        );
        if (r.score > 0) {
          candidates.push({ bankId: b._id, cardId: '', score: r.score, reason: r.reason, date: b.transactionDate });
        }
      }

      // Card candidates — 카드는 사용일 기준 7일 이내
      for (const c of this.cards) {
        if (this.usedCardIds.has(c._id)) continue;
        if (c.company !== ht.company) continue;
        if (c.amount <= 0 || c.isCancelled) continue;

        const cardDate = c.usedAt.substring(0, 10);
        const r = scoreCandidate(
          ht.totalAmount, ht.vendorName, ht.issuedDate,
          c.amount,
          [c.merchantName, c.businessNo],
          cardDate,
          7
        );
        if (r.score > 0) {
          candidates.push({ bankId: '', cardId: c._id, score: r.score, reason: r.reason, date: cardDate });
        }
      }

      if (candidates.length === 0) {
        // Unmatched HT: create cashflow entry with invoice date
        // entry_date: 작성일자(A열) 우선, 없으면 발급일자(C열)
      const unmatchedDate = ht.writtenDate || ht.issuedDate;
      const unmatchedEntry = this.htEntry(ht, 'UNMATCHED', 'hometax_unmatched', '', '', unmatchedDate);
      unmatchedEntry.amountStatus    = '지급 예정';
      unmatchedEntry.invoiceAmount   = ht.totalAmount;
      unmatchedEntry.remainingAmount = ht.totalAmount;
      unmatchedEntry.incomeAmount    = 0;
      unmatchedEntry.expenseAmount   = 0; // 아직 지급 안됨 → 예정만 표시
      unmatchedEntry.showInCashflow  = true;
      this.cashflow.push(unmatchedEntry);
        continue;
      }

      // Sort by score desc
      candidates.sort((a, b) => b.score - a.score);
      const top = candidates[0];

      // Determine status:
      // AUTO_MATCHED needs either vendor similarity > 0.3 OR only 1 candidate with high score
      const dupScores    = candidates.filter(c => c.score >= top.score - 0.05);
      const vendorHit    = top.reason.includes('거래처유사') && !top.reason.includes('거래처미확인');
      // 동점 후보가 여럿이어도 모두 완전히 같은 점수(동일 거래)면 AUTO — 순차 소비로 N:N 해소
      const allTied      = dupScores.every(c => Math.abs(c.score - top.score) < 0.001);
      // Require vendor match for AUTO; pure amount+date match alone → MANUAL_REVIEW
      const isAutoMatch  = top.score >= 0.75 && vendorHit && (dupScores.length === 1 || allTied);
      const status: MatchStatus = isAutoMatch ? 'AUTO_MATCHED' : 'MANUAL_REVIEW';

      // Mark as used
      this.usedHtIds.add(ht._id);
      if (top.bankId)  this.usedBankIds.add(top.bankId);
      if (top.cardId)  this.usedCardIds.add(top.cardId);

      const paySourceType = top.bankId ? (this.banks.find(b => b._id === top.bankId)?.sourceType ?? 'BANK_IBK') : (this.cards.find(c => c._id === top.cardId)?.sourceType ?? 'CARD_IBK');

      this.matched.push({
        id:               makeId('mp'),
        matchType:        top.bankId ? 'HT_PURCHASE-BANK' : 'HT_PURCHASE-CARD',
        score:            top.score,
        hometaxInvoiceId: ht._id,
        bankTransactionId: top.bankId,
        cardTransactionId: top.cardId,
        fixedCostId:      '',
        matchReason:      top.reason,
      });

      const vname = ht.vendorName;
      // entry_date: 작성일자(A열) 우선, 없으면 발급일자(C열)
      const entryDate = ht.writtenDate || ht.issuedDate;
      const isFullyPaid = Math.abs(ht.totalAmount - (top.bankId
        ? (this.banks.find(b => b._id === top.bankId)?.withdrawAmount ?? 0)
        : (this.cards.find(c => c._id === top.cardId)?.amount ?? 0))) <= 10;

      this.cashflow.push({
        id:              makeId('cf'),
        company:         ht.company,
        date:            entryDate,
        vendorName:      vname,
        category:        '매입',
        subCategory:     ht.taxType === 'exempt' ? '매입(면세)' : '매입(과세)',
        incomeAmount:    0,
        expenseAmount:   ht.totalAmount,
        sourceType:      ht.sourceType,
        paymentSourceType: paySourceType,
        matchStatus:     status,
        matchReason:     top.reason + (ht.isCancelled ? ' [수정계산서주의]' : '') + (top.cardId ? ` [카드결제: 발급일자 ${ht.issuedDate} 기준]` : ''),
        hometaxInvoiceId: ht._id,
        bankTransactionId: top.bankId,
        cardTransactionId: top.cardId,
        fixedCostId:     '',
        amountStatus:    status === 'AUTO_MATCHED' ? (isFullyPaid ? '지급 완료' : '부분 지급') : '매칭 필요',
        invoiceAmount:   ht.totalAmount,
        actualAmount:    top.bankId ? (this.banks.find(b => b._id === top.bankId)?.withdrawAmount ?? 0) : (this.cards.find(c => c._id === top.cardId)?.amount ?? 0),
        showInCashflow:  true,
      });
    }
  }

  // ── Step 4: HT 매출 ↔ 은행입금 ─────────────────────────────────────────
  private step4_htSales() {
    const salesHts = this.hts.filter(
      h => h.sourceType === 'HT_SALES_TAX' && !this.usedHtIds.has(h._id)
    );

    for (const ht of salesHts) {
      const candidates: HtCandidate[] = [];

      for (const b of this.banks) {
        if (this.usedBankIds.has(b._id)) continue;
        if (b.company !== ht.company) continue;
        if (b.depositAmount <= 0) continue;

        const r = scoreCandidate(
          ht.totalAmount, ht.customerName, ht.issuedDate,
          b.depositAmount,
          [b.description, b.counterAccountName],
          b.transactionDate
        );
        if (r.score > 0) {
          candidates.push({ bankId: b._id, cardId: '', score: r.score, reason: r.reason, date: b.transactionDate });
        }
      }

      if (candidates.length === 0) {
        // 미매칭 매출: 작성일자 기준, 입금 예정 상태로 생성
        const salesDate = ht.writtenDate || ht.issuedDate;
        const unmatched = this.htSalesEntry(ht, 'UNMATCHED', 'hometax_sales_unmatched', '', salesDate);
        unmatched.amountStatus    = '입금 예정';
        unmatched.invoiceAmount   = ht.totalAmount;
        unmatched.remainingAmount = ht.totalAmount;
        unmatched.incomeAmount    = 0; // 아직 미입금
        unmatched.showInCashflow  = true;
        this.cashflow.push(unmatched);
        continue;
      }

      candidates.sort((a, b) => b.score - a.score);
      const top = candidates[0];
      const dupScores2   = candidates.filter(c => c.score >= top.score - 0.05);
      const vendorHit2   = top.reason.includes('거래처유사') && !top.reason.includes('거래처미확인');
      // 동점 후보가 여럿이어도 모두 완전히 같은 점수(동일 거래)면 AUTO — 순차 소비로 N:N 해소
      const allTied2     = dupScores2.every(c => Math.abs(c.score - top.score) < 0.001);
      const isAuto2      = top.score >= 0.75 && vendorHit2 && (dupScores2.length === 1 || allTied2);
      const status: MatchStatus = isAuto2 ? 'AUTO_MATCHED' : 'MANUAL_REVIEW';

      this.usedHtIds.add(ht._id);
      this.usedBankIds.add(top.bankId);

      this.matched.push({
        id:               makeId('mp'),
        matchType:        'HT_SALES-BANK',
        score:            top.score,
        hometaxInvoiceId: ht._id,
        bankTransactionId: top.bankId,
        cardTransactionId: '',
        fixedCostId:      '',
        matchReason:      top.reason,
      });

      const vname = ht.customerName;
      // 매칭된 은행 입금 금액
      const depositBank  = this.banks.find(b => b._id === top.bankId);
      const depositAmt   = depositBank?.depositAmount ?? 0;
      const isFullSales  = Math.abs(ht.totalAmount - depositAmt) <= 10;
      const salesEntryDate = ht.writtenDate || ht.issuedDate;

      this.cashflow.push({
        id:              makeId('cf'),
        company:         ht.company,
        date:            salesEntryDate,  // 작성일자(A열) 기준
        vendorName:      vname,
        category:        '매출',
        subCategory:     '매출수금',
        incomeAmount:    ht.totalAmount,  // 세금계산서 총액을 income으로
        expenseAmount:   0,
        sourceType:      'HT_SALES_TAX',
        paymentSourceType: 'BANK_IBK',
        matchStatus:     status,
        matchReason:     top.reason,
        hometaxInvoiceId: ht._id,
        bankTransactionId: top.bankId,
        cardTransactionId: '',
        fixedCostId:     '',
        amountStatus:     status === 'AUTO_MATCHED'
          ? (isFullSales ? '입금 완료' : (depositAmt > ht.totalAmount ? '초과 입금 검토 필요' : '부분 입금'))
          : '매칭 필요',
        invoiceAmount:    ht.totalAmount,
        actualAmount:     depositAmt,
        accumulatedAmount: depositAmt,
        remainingAmount:  Math.max(0, ht.totalAmount - depositAmt),
        actualDate:       depositBank?.transactionDate,
        showInCashflow:   true,
      });
    }
  }

  // ── Step 5: 미매칭 잔여 ────────────────────────────────────────────────
  private step5_remaining() {
    // Remaining bank transactions
    for (const b of this.banks) {
      if (this.usedBankIds.has(b._id)) continue;

      if (b.depositAmount > 0) {
        this.cashflow.push({
          id:              makeId('cf'),
          company:         b.company,
          date:            b.transactionDate,
          vendorName:      b.counterAccountName || b.description,
          category:        '기타수입',
          subCategory:     b.description,
          incomeAmount:    b.depositAmount,
          expenseAmount:   0,
          sourceType:      b.sourceType,
          paymentSourceType: b.sourceType,
          matchStatus:     'UNMATCHED',
          matchReason:     'bank_deposit_unmatched',
          hometaxInvoiceId: '',
          bankTransactionId: b._id,
          cardTransactionId: '',
          fixedCostId:     '',
          showInCashflow:  true,
        });
      } else if (b.withdrawAmount > 0) {
        this.cashflow.push({
          id:              makeId('cf'),
          company:         b.company,
          date:            b.transactionDate,
          vendorName:      b.counterAccountName || b.description,
          category:        '기타지출',
          subCategory:     b.description,
          incomeAmount:    0,
          expenseAmount:   b.withdrawAmount,
          sourceType:      b.sourceType,
          paymentSourceType: b.sourceType,
          matchStatus:     'UNMATCHED',
          matchReason:     'bank_withdrawal_unmatched',
          hometaxInvoiceId: '',
          bankTransactionId: b._id,
          cardTransactionId: '',
          fixedCostId:     '',
          showInCashflow:  true,
        });
      }
    }

    // Remaining card transactions (non-cancelled, not used)
    for (const c of this.cards) {
      if (this.usedCardIds.has(c._id)) continue;
      if (c.isCancelled || c.amount <= 0) continue;

      this.cashflow.push({
        id:              makeId('cf'),
        company:         c.company,
        date:            c.paymentDueDate || c.usedAt.substring(0, 10),
        vendorName:      c.merchantName,
        category:        '카드지출',
        subCategory:     c.salesType,
        incomeAmount:    0,
        expenseAmount:   c.amount,
        sourceType:      c.sourceType,
        paymentSourceType: c.sourceType,
        matchStatus:     'UNMATCHED',
        matchReason:     'card_unmatched',
        hometaxInvoiceId: '',
        bankTransactionId: '',
        cardTransactionId: c._id,
        fixedCostId:     '',
      });
    }
  }

  // ── Helper builders ────────────────────────────────────────────────────
  private htEntry(
    ht: TaggedHT, status: MatchStatus, reason: string,
    bankId: string, cardId: string, _date: string  // _date 인수는 writtenDate||issuedDate로 오버라이드됨
  ): CashflowEntry {
    const entryDate = ht.writtenDate || ht.issuedDate;
    return {
      id:              makeId('cf'),
      company:         ht.company,
      date:            entryDate,
      vendorName:      ht.vendorName,
      category:        '매입',
      subCategory:     ht.taxType === 'exempt' ? '매입(면세)' : '매입(과세)',
      incomeAmount:    0,
      expenseAmount:   ht.totalAmount,
      sourceType:      ht.sourceType,
      paymentSourceType: '',
      matchStatus:     status,
      matchReason:     reason,
      hometaxInvoiceId: ht._id,
      bankTransactionId: bankId,
      cardTransactionId: cardId,
      fixedCostId:     '',
      invoiceAmount:   ht.totalAmount,
      showInCashflow:  true,
    };
  }

  private htSalesEntry(
    ht: TaggedHT, status: MatchStatus, reason: string,
    bankId: string, _date: string  // _date 인수는 writtenDate||issuedDate로 오버라이드됨
  ): CashflowEntry {
    const entryDate = ht.writtenDate || ht.issuedDate;
    return {
      id:              makeId('cf'),
      company:         ht.company,
      date:            entryDate,
      vendorName:      ht.customerName,
      category:        '매출',
      subCategory:     '매출수금',
      incomeAmount:    ht.totalAmount,
      expenseAmount:   0,
      sourceType:      'HT_SALES_TAX',
      paymentSourceType: '',
      matchStatus:     status,
      matchReason:     reason,
      hometaxInvoiceId: ht._id,
      bankTransactionId: bankId,
      cardTransactionId: '',
      fixedCostId:     '',
      invoiceAmount:   ht.totalAmount,
      showInCashflow:  true,
    };
  }

  // ── Unmatched collections ───────────────────────────────────────────────
  getUnmatchedBanks():  TaggedBank[] { return this.banks.filter(b => !this.usedBankIds.has(b._id)); }
  getUnmatchedCards():  TaggedCard[] { return this.cards.filter(c => !this.usedCardIds.has(c._id)); }
  getUnmatchedHts():    TaggedHT[]   { return this.hts.filter(h => !this.usedHtIds.has(h._id)); }
}
