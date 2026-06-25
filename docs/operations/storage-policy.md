# Storage 정책 (finance-raw 버킷)

## 버킷 설정

| 항목 | 값 |
|------|-----|
| 이름 | `finance-raw` |
| 공개 여부 | private (public = false) |
| 파일 크기 제한 | 4,194,304 bytes (4MB) |
| 허용 MIME | xlsx, xls, csv, octet-stream |

## 보안 모델

- **브라우저 직접 접근 없음**: 인증 사용자도 Storage에 직접 읽기/쓰기 불가.
- **서버 전용 접근**: API 서버(`service_role key`)만 업로드·다운로드 가능.
- `service_role key`는 RLS를 우회하므로 Storage RLS 정책을 별도 생성하지 않아도 서버가 접근 가능.
- Storage RLS 정책 ≠ `service_role` 사용 통제. `service_role`은 DB·Storage 모두 RLS 우회.

## 파일 경로 규칙

```
{company_code}/{YYYY-MM}/{unix_timestamp}_{original_filename}
```

예시: `feedback/2026-06/1719123456789_우리은행_202606.xlsx`

## 원본 파일 열람 방법 (향후)

브라우저에서 원본 파일을 열람해야 할 경우:
1. 서버 API에 요청
2. 서버가 권한 검증 (company_id 일치 여부 등)
3. 서버가 서명된 URL(signed URL) 생성 → 클라이언트에 단기 URL 전달
4. 클라이언트가 단기 URL로 직접 다운로드

현재(Phase 1): signed URL 발급 엔드포인트 미구현. `storage_path` 컬럼에 경로만 보관.

## 수동 버킷 생성 방법

**방법 A — Supabase Dashboard:**
1. Storage → New bucket
2. Name: `finance-raw`, Public: OFF
3. File size limit: 4194304, MIME: 위 표 참고

**방법 B — SQL Editor (Supabase 관리 권한):**
```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'finance-raw', 'finance-raw', false, 4194304,
  ARRAY[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/octet-stream'
  ]
) ON CONFLICT (id) DO NOTHING;
```

## Vercel 업로드 한도

- Vercel Pro body limit: **4.5MB** (요청 전체)
- 코드 적용 제한:
  - 파일당 최대: 4MB (`MAX_FILE_SIZE`)
  - 최대 파일 수: 10개 (`MAX_FILES`)
  - 총 합계: 4MB (`TOTAL_SIZE_LIMIT`)
- 향후 대용량 지원: 브라우저 → Storage 직접 업로드 방식으로 전환 필요
