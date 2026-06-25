# 업로드 정책

## 흐름 요약

```
브라우저 multipart POST /api/upload
  → 파일 검증 (확장자, 크기, 총 합계)
  → parseUploadedFile() 파일별 파싱
  → importUploadedResults() 파일별 DB 반영
      ├── Supabase Storage 업로드 (finance-raw)
      ├── source_files 레코드 생성 (pending → storage_uploaded → importing → success/partial/error)
      ├── bank/card/HT upsert (source_hash 기준, 기존 행 덮어쓰지 않음)
      ├── transaction_source_links (PRIMARY/DUPLICATE_SOURCE)
      ├── source_parse_warnings
      └── finance_audit_logs (IMPORT_COMPLETE)
  → runRematch() 영향 월별 재매칭
      ├── matching_runs INSERT (법인별)
      ├── 이전 transaction_matches SUPERSEDED
      ├── 신규 transaction_matches INSERT
      ├── cashflow_entries 교체 (USER_EDITED/USER_CONFIRMED 보존)
      └── matching_runs UPDATE (completed/failed)
```

## 파일 제한

| 항목 | 값 |
|------|-----|
| 허용 확장자 | .xlsx, .xls, .csv |
| 파일당 최대 크기 | 4MB |
| 최대 파일 수 | 10개 |
| 총 크기 합계 | 4MB |

## source_hash 중복 처리

동일 파일(또는 동일 거래)이 재업로드될 경우:
- 기존 bank/card/HT 행의 `source_file_id`, `source_row_number`는 변경하지 않음
- 새 `source_files` 레코드를 생성하고 `DUPLICATE_SOURCE` 링크 추가
- `cashflow_entries`는 기존 행이 있으면 skip (FK 중복 방지 로직)

## USER_EDITED / USER_CONFIRMED 보호

재매칭(runRematch) 시:
- `match_status IN ('USER_EDITED', 'USER_CONFIRMED')` 인 cashflow_entries는 삭제하지 않음
- 해당 행이 연결된 bank/card/HT FK로 새 항목을 생성하지 않음 (existingFKs 체크)

## source_files 상태 전이

```
pending
  → storage_uploaded  (Storage 업로드 성공)
  → importing         (DB 반영 시작)
  → success           (모든 행 성공)
     partial          (일부 오류)
     error            (전체 실패 또는 Storage 업로드 실패)
```

## source_row_number 기준

- **1-based**: 사용자가 Excel에서 직접 확인할 수 있는 행 번호
- 헤더 행 포함하여 카운트 (Excel 행 번호와 동일)
- `rowIndex + 1` (파서 내부 0-based 배열 인덱스에서 변환)
