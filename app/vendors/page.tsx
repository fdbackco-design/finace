export const dynamic    = 'force-dynamic';
export const revalidate = 0;

import { fetchTable } from '@/src/lib/supabase/server';
import VendorClient, { type Vendor } from './VendorClient';

type VendorRow = {
  id:                  string;
  vendor_name:         string;
  representative_name: string | null;
  created_at:          string;
  vendor_aliases: {
    id:              string;
    vendor_id:       string;
    source_name:     string | null;
    business_number: string | null;
    created_at:      string;
  }[];
};

export default async function VendorsPage() {
  const result = await fetchTable<VendorRow>(
    'vendors',
    (client) =>
      client
        .from('vendors')
        .select('id, vendor_name, representative_name, created_at, vendor_aliases(id, vendor_id, source_name, business_number, created_at)')
        .order('vendor_name') as any,
  );

  const vendors: Vendor[] = result.status === 'ok' ? (result.data as unknown as Vendor[]) : [];

  return <VendorClient initialVendors={vendors} />;
}
