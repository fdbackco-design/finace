'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/src/lib/supabase/server';

export type InterestLoan = {
  id:                    string;
  company_code:          string;
  loan_bank:             string;
  account_number:        string | null;
  financial_institution: string;
  loan_start_date:       string;
  loan_end_date:         string;
  payment_day:           number;
  interest_amount:       number;
  memo:                  string | null;
  is_active:             boolean;
  created_at:            string;
};

const COMPANY_LABEL: Record<string, string> = {
  feedback:  '피드백',
  sangsaeng: '상생',
  shootmoon: '슛문',
};

// ── 이자 cashflow_entries 동기화 ──────────────────────────────────────────────

async function syncLoanEntries(
  client: ReturnType<typeof createServerClient>,
  loanId: string,
  loan: {
    company_code:          string;
    financial_institution: string;
    loan_bank:             string;
    account_number:        string | null;
    loan_start_date:       string;
    loan_end_date:         string;
    payment_day:           number;
    interest_amount:       number;
    memo:                  string | null;
    is_active:             boolean;
  },
): Promise<void> {
  if (!client) return;

  // 기존 entries 삭제
  await client.from('cashflow_entries').delete().eq('interest_loan_id', loanId);

  if (!loan.is_active) return;

  // company_id 조회
  const { data: company } = await client
    .from('companies')
    .select('id')
    .eq('company_code', loan.company_code)
    .single();

  if (!company) return;

  const [sy, sm] = loan.loan_start_date.split('-').map(Number);
  const [ey, em] = loan.loan_end_date.split('-').map(Number);

  const entries: object[] = [];
  let curYear  = sy;
  let curMonth = sm;

  while (curYear < ey || (curYear === ey && curMonth <= em)) {
    const lastDay   = new Date(curYear, curMonth, 0).getDate();
    const day       = Math.min(loan.payment_day, lastDay);
    const entryDate = `${curYear}-${String(curMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    if (entryDate >= loan.loan_start_date && entryDate <= loan.loan_end_date) {
      entries.push({
        company_id:       company.id,
        company_code:     loan.company_code,
        entry_date:       entryDate,
        vendor_name:      loan.financial_institution,
        category:         '이자',
        sub_category:     loan.loan_bank,
        income_amount:    0,
        expense_amount:   loan.interest_amount,
        source_type:      'MANUAL',
        match_status:     'USER_CONFIRMED',
        interest_loan_id: loanId,
        memo:             loan.account_number
          ? `${loan.loan_bank} / 계좌 ${loan.account_number}`
          : loan.loan_bank,
      });
    }

    if (curMonth === 12) { curYear++; curMonth = 1; }
    else { curMonth++; }
  }

  if (entries.length > 0) {
    await client.from('cashflow_entries').insert(entries);
  }
}

// ── 등록 ──────────────────────────────────────────────────────────────────────

export async function createLoan(formData: FormData): Promise<{ error?: string }> {
  const companyCode = (formData.get('company_code') as string ?? '').trim();
  const loanBank    = (formData.get('loan_bank')    as string ?? '').trim();
  const accountNo   = (formData.get('account_number') as string ?? '').trim() || null;
  const institution = (formData.get('financial_institution') as string ?? '').trim();
  const startDate   = (formData.get('loan_start_date') as string ?? '').trim();
  const endDate     = (formData.get('loan_end_date')   as string ?? '').trim();
  const payDay      = parseInt(formData.get('payment_day') as string ?? '0', 10);
  const amount      = parseInt((formData.get('interest_amount') as string ?? '0').replace(/,/g, ''), 10);
  const memo        = (formData.get('memo') as string ?? '').trim() || null;

  if (!companyCode || !COMPANY_LABEL[companyCode]) return { error: '회사를 선택하세요.' };
  if (!loanBank)    return { error: '대출은행을 입력하세요.' };
  if (!institution) return { error: '금융기관명을 입력하세요.' };
  if (!startDate || !endDate)     return { error: '대출기간을 입력하세요.' };
  if (startDate > endDate)        return { error: '종료일이 시작일보다 빠릅니다.' };
  if (payDay < 1 || payDay > 31)  return { error: '납부일은 1~31 사이여야 합니다.' };
  if (!amount || amount <= 0)     return { error: '이자 금액을 입력하세요.' };

  const client = createServerClient();
  if (!client) return { error: 'DB 연결 실패' };

  const loanData = {
    company_code:          companyCode,
    loan_bank:             loanBank,
    account_number:        accountNo,
    financial_institution: institution,
    loan_start_date:       startDate,
    loan_end_date:         endDate,
    payment_day:           payDay,
    interest_amount:       amount,
    memo,
    is_active:             true,
  };

  const { data: loan, error: le } = await client
    .from('interest_loans')
    .insert(loanData)
    .select('id')
    .single();

  if (le || !loan) return { error: le?.message ?? '등록 실패' };

  await syncLoanEntries(client, loan.id, loanData);

  revalidatePath('/interest');
  revalidatePath('/cashflow');
  return {};
}

// ── 수정 ──────────────────────────────────────────────────────────────────────

export async function updateLoan(
  loanId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const companyCode = (formData.get('company_code') as string ?? '').trim();
  const loanBank    = (formData.get('loan_bank')    as string ?? '').trim();
  const accountNo   = (formData.get('account_number') as string ?? '').trim() || null;
  const institution = (formData.get('financial_institution') as string ?? '').trim();
  const startDate   = (formData.get('loan_start_date') as string ?? '').trim();
  const endDate     = (formData.get('loan_end_date')   as string ?? '').trim();
  const payDay      = parseInt(formData.get('payment_day') as string ?? '0', 10);
  const amount      = parseInt((formData.get('interest_amount') as string ?? '0').replace(/,/g, ''), 10);
  const memo        = (formData.get('memo') as string ?? '').trim() || null;

  if (!companyCode || !COMPANY_LABEL[companyCode]) return { error: '회사를 선택하세요.' };
  if (!loanBank)    return { error: '대출은행을 입력하세요.' };
  if (!institution) return { error: '금융기관명을 입력하세요.' };
  if (!startDate || !endDate)     return { error: '대출기간을 입력하세요.' };
  if (startDate > endDate)        return { error: '종료일이 시작일보다 빠릅니다.' };
  if (payDay < 1 || payDay > 31)  return { error: '납부일은 1~31 사이여야 합니다.' };
  if (!amount || amount <= 0)     return { error: '이자 금액을 입력하세요.' };

  const client = createServerClient();
  if (!client) return { error: 'DB 연결 실패' };

  const loanData = {
    company_code:          companyCode,
    loan_bank:             loanBank,
    account_number:        accountNo,
    financial_institution: institution,
    loan_start_date:       startDate,
    loan_end_date:         endDate,
    payment_day:           payDay,
    interest_amount:       amount,
    memo,
  };

  const { error: ue } = await client
    .from('interest_loans')
    .update(loanData)
    .eq('id', loanId);

  if (ue) return { error: ue.message };

  const { data: updated } = await client
    .from('interest_loans')
    .select('is_active')
    .eq('id', loanId)
    .single();

  await syncLoanEntries(client, loanId, { ...loanData, is_active: updated?.is_active ?? true });

  revalidatePath('/interest');
  revalidatePath('/cashflow');
  return {};
}

// ── 삭제 ──────────────────────────────────────────────────────────────────────

export async function deleteLoan(loanId: string): Promise<{ error?: string }> {
  const client = createServerClient();
  if (!client) return { error: 'DB 연결 실패' };

  // cashflow_entries는 ON DELETE CASCADE로 자동 삭제됨
  const { error } = await client.from('interest_loans').delete().eq('id', loanId);
  if (error) return { error: error.message };

  revalidatePath('/interest');
  revalidatePath('/cashflow');
  return {};
}
