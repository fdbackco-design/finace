# 데이터 계보 설계 (Phase 1)

## 원천 추적 경로

```
[원본 파일 (xlsx)]
      │
      ↓ Storage 업로드
[finance-raw 버킷]
  storage_path: {company}/{YYYY-MM}/{ts}_{filename}
      │
      ↓ source_files INSERT
[source_files]
  id, filename, file_size_bytes, file_content_hash,
  storage_path, status, parse_warning_count, success_row_count, ...
      │
      ├─→ [source_parse_warnings]
      │       source_row_number (1-based), severity, raw_row_json (오류 행만)
      │
      └─→ 파싱된 행들
              │
              ↓ INSERT (신규) / 기존 행 유지 (source_hash 충돌)
     [bank_transactions / card_transactions / hometax_invoices]
       source_row_number, source_sheet_name (최초 생성 시만 기록)
              │
              ↓ link_type = PRIMARY (신규) or DUPLICATE_SOURCE (재업로드)
     [transaction_source_links]
       source_file_id → bank/card/ht id
```

## source_hash 충돌 처리 원칙

1. 기존 행 (`source_hash` 이미 존재): INSERT 건너뜀
2. 기존 행의 `source_file_id`, `source_row_number` **절대 덮어쓰지 않음**
3. 새 `source_files` 레코드는 생성
4. 새 파일 → 기존 거래 간 `DUPLICATE_SOURCE` 링크 추가

```
원본 파일 A (최초 업로드)
  → bank_transaction 생성 (source_row_number=4, source_sheet_name='Sheet1')
  → transaction_source_links: file_A → bank_tx, link_type=PRIMARY

동일 파일 B (재업로드)
  → bank_transaction INSERT 건너뜀 (source_hash 충돌)
  → transaction_source_links: file_B → bank_tx, link_type=DUPLICATE_SOURCE
```

## 역방향 조회

"이 거래가 어느 원본 파일에 있었나?"
```sql
SELECT sf.filename, tsl.link_type, tsl.source_row_number
FROM transaction_source_links tsl
JOIN source_files sf ON sf.id = tsl.source_file_id
WHERE tsl.bank_transaction_id = '<uuid>';
```

## Phase 2 이후 예정 (현재 미구현)

- `parsed_rows` 테이블: 정상 행의 raw_row_json 전체 보존
- N:N 금액 배분 (`match_allocations`)
- `cash_events` / `obligations` 분리
- 원본 파일 열람 API (signed URL)
