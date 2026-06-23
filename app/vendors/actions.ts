'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/src/lib/supabase/server';
import { applyVendorMapping, type VendorAlias } from '@/src/lib/vendors/mapping';

// ── 거래처 등록 ────────────────────────────────────────────────────────────────
export async function createVendor(formData: FormData): Promise<{ error?: string }> {
  const vendorName        = (formData.get('vendor_name') as string ?? '').trim();
  const representativeName = (formData.get('representative_name') as string ?? '').trim() || null;
  const sourceName        = (formData.get('source_name') as string ?? '').trim() || null;
  const businessNo        = (formData.get('business_number') as string ?? '').trim() || null;

  if (!vendorName) return { error: '거래처명은 필수입니다.' };

  const client = createServerClient();
  if (!client) return { error: 'DB 연결 실패' };

  const { data: vendor, error: ve } = await client
    .from('vendors')
    .insert({ vendor_name: vendorName, representative_name: representativeName })
    .select('id')
    .single();

  if (ve || !vendor) return { error: ve?.message ?? '등록 실패' };

  if (sourceName || businessNo) {
    await client.from('vendor_aliases').insert({
      vendor_id:       vendor.id,
      source_name:     sourceName,
      business_number: businessNo,
    });
  }

  revalidatePath('/vendors');
  return {};
}

// ── 거래처 정보 수정 ──────────────────────────────────────────────────────────
export async function updateVendorName(
  vendorId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const vendorName         = (formData.get('vendor_name') as string ?? '').trim();
  const representativeName = (formData.get('representative_name') as string ?? '').trim() || null;
  if (!vendorName) return { error: '거래처명은 필수입니다.' };

  const client = createServerClient();
  if (!client) return { error: 'DB 연결 실패' };

  const { error } = await client
    .from('vendors')
    .update({ vendor_name: vendorName, representative_name: representativeName })
    .eq('id', vendorId);

  if (error) return { error: error.message };

  revalidatePath('/vendors');
  return {};
}

// ── 거래처 삭제 ────────────────────────────────────────────────────────────────
export async function deleteVendor(vendorId: string): Promise<{ error?: string }> {
  const client = createServerClient();
  if (!client) return { error: 'DB 연결 실패' };

  // vendor_aliases는 ON DELETE CASCADE, cashflow_entries.vendor_id는 ON DELETE SET NULL
  const { error } = await client.from('vendors').delete().eq('id', vendorId);
  if (error) return { error: error.message };

  revalidatePath('/vendors');
  return {};
}

// ── 원본명/사업자번호 추가 ─────────────────────────────────────────────────────
export async function addAlias(
  vendorId:       string,
  sourceName:     string | null,
  businessNumber: string | null,
): Promise<{ error?: string }> {
  if (!sourceName && !businessNumber) return { error: '원본명 또는 사업자번호 중 하나는 필요합니다.' };

  const client = createServerClient();
  if (!client) return { error: 'DB 연결 실패' };

  const { error } = await client.from('vendor_aliases').insert({
    vendor_id:       vendorId,
    source_name:     sourceName || null,
    business_number: businessNumber || null,
  });

  if (error) return { error: error.message };

  revalidatePath('/vendors');
  return {};
}

// ── 원본명 삭제 ────────────────────────────────────────────────────────────────
export async function deleteAlias(aliasId: string): Promise<{ error?: string }> {
  const client = createServerClient();
  if (!client) return { error: 'DB 연결 실패' };

  const { error } = await client.from('vendor_aliases').delete().eq('id', aliasId);
  if (error) return { error: error.message };

  revalidatePath('/vendors');
  return {};
}

// ── 기존 거래내역 전체 재매핑 ─────────────────────────────────────────────────
export async function remapAllEntries(): Promise<{ updated: number; error?: string }> {
  const client = createServerClient();
  if (!client) return { updated: 0, error: 'DB 연결 실패' };

  // 1. 모든 aliases + vendor_name 로드
  const { data: rawAliases } = await client
    .from('vendor_aliases')
    .select('id, vendor_id, source_name, business_number, vendors(vendor_name, representative_name)');

  const aliases: VendorAlias[] = (rawAliases ?? []).map((a: any) => ({
    id:                  a.id,
    vendor_id:           a.vendor_id,
    vendor_name:         a.vendors?.vendor_name ?? '',
    representative_name: a.vendors?.representative_name ?? null,
    source_name:         a.source_name,
    business_number:     a.business_number,
  })).filter(a => a.vendor_name);

  if (aliases.length === 0) return { updated: 0 };

  // 기존 매핑 초기화
  await client
    .from('cashflow_entries')
    .update({ vendor_id: null, vendor_name_mapped: null })
    .not('vendor_id', 'is', null);

  // 2. cashflow_entries 전체 로드 (vendor_name + source refs)
  const { data: entries } = await client
    .from('cashflow_entries')
    .select('id, vendor_name, hometax_invoice_id, card_transaction_id');

  if (!entries || entries.length === 0) return { updated: 0 };

  // 3. HT 계산서 사업자번호 맵
  const htIds = entries
    .filter((e: any) => e.hometax_invoice_id)
    .map((e: any) => e.hometax_invoice_id);

  const htBizNoMap = new Map<string, string>();
  if (htIds.length > 0) {
    const { data: htRows } = await client
      .from('hometax_invoices')
      .select('id, vendor_business_no')
      .in('id', htIds);
    for (const h of htRows ?? []) {
      if (h.vendor_business_no) htBizNoMap.set(h.id, h.vendor_business_no);
    }
  }

  // 4. 카드 거래 사업자번호 맵
  const cardIds = entries
    .filter((e: any) => e.card_transaction_id)
    .map((e: any) => e.card_transaction_id);

  const cardBizNoMap = new Map<string, string>();
  if (cardIds.length > 0) {
    const { data: cardRows } = await client
      .from('card_transactions')
      .select('id, business_no')
      .in('id', cardIds);
    for (const c of cardRows ?? []) {
      if (c.business_no) cardBizNoMap.set(c.id, c.business_no);
    }
  }

  // 5. 매핑 계산 → vendor별로 그룹핑
  const vendorEntries = new Map<string, { vendor_name: string; ids: string[] }>();

  for (const entry of entries) {
    const htBizNo   = entry.hometax_invoice_id ? htBizNoMap.get(entry.hometax_invoice_id) : undefined;
    const cardBizNo = entry.card_transaction_id ? cardBizNoMap.get(entry.card_transaction_id) : undefined;
    const bizNo     = htBizNo ?? cardBizNo ?? null;

    const result = applyVendorMapping(entry.vendor_name, bizNo, aliases);
    if (!result) continue;

    const key = result.vendor_id;
    if (!vendorEntries.has(key)) {
      vendorEntries.set(key, { vendor_name: result.vendor_name, ids: [] });
    }
    vendorEntries.get(key)!.ids.push(entry.id);
  }

  // 6. 배치 업데이트 (vendor별 IN 쿼리)
  let totalUpdated = 0;
  for (const [vendor_id, { vendor_name, ids }] of vendorEntries) {
    // IN 쿼리 최대 1000개씩
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      const { error } = await client
        .from('cashflow_entries')
        .update({ vendor_id, vendor_name_mapped: vendor_name })
        .in('id', chunk);
      if (!error) totalUpdated += chunk.length;
    }
  }

  revalidatePath('/cashflow');
  return { updated: totalUpdated };
}
