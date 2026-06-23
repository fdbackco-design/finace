export const dynamic    = 'force-dynamic';
export const revalidate = 0;

import { fetchTable } from '@/src/lib/supabase/server';
import InterestClient from './InterestClient';
import { type InterestLoan } from './actions';

export default async function InterestPage() {
  const result = await fetchTable<InterestLoan>(
    'interest_loans',
    (client) =>
      client
        .from('interest_loans')
        .select('id,company_code,loan_bank,account_number,financial_institution,loan_start_date,loan_end_date,payment_day,interest_amount,memo,is_active,created_at')
        .order('company_code')
        .order('created_at') as any,
  );

  const loans: InterestLoan[] = result.status === 'ok' ? result.data : [];

  return <InterestClient initialLoans={loans} />;
}
