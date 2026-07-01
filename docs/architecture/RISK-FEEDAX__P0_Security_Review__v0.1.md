# RISK-FEEDAX · P0 Security Review v0.1

> REQ-FEEDAX v0.2 요청 산출물 중 **보안 리뷰**. 담당: 이명진 + 경영지원부.
> 정본: `TECH-FEEDAX__Source_Lineage__AS-IS_현행정리__v0.1.md` (§10·§13 정밀 확장).
> 보안등급 SECRET. 기준일 2026-07-01.

**결론 요약:** 원본성·불변성·감사로그는 견고(✅). 반면 **접근권한(RBAC)·법인격리·질의로그**는
미착수(⬜)이며, 현재 실질 보안 경계는 "자체 로그인 쿠키 + 서버 독점 service_role" 2겹에 의존.

---

## 1. 인증 (구현됨 ✅)
`src/lib/auth/session.ts`
- env 단일 관리자: `ADMIN_USERNAME` / `ADMIN_PASSWORD`
- 세션: HMAC-SHA256 서명 쿠키 `finance_auth` (secret = `user:pass`), 만료 7일, httpOnly·sameSite=lax
- `timingSafeEqual` 상수시간 비교로 타이밍 공격 방어
- **역할 구분 없음** — admin/viewer/CEO/FINANCE 구분 미존재 (RPC의 `actor_role`은 앱이 임의 주입하는 문자열)

## 2. RLS 정책 — 실제 효력 분석 (핵심 리스크)

### 정책 원문 (2세대)
**Phase1 (`001`) 11개 테이블** (companies, upload_sessions, source_files, bank/card/hometax_transactions, fixed_cost_rules, cashflow_entries, transaction_matches, unmatched_items, bank_balances):
```sql
FOR SELECT USING     (auth.role() = 'authenticated');
FOR INSERT WITH CHECK(auth.role() = 'authenticated');
FOR UPDATE USING     (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
FOR DELETE USING     (auth.role() = 'service_role');
```
**`004`/`008`/`010~024`** (vendors, cashflow_v2, source/matching/phase2 전 테이블):
```sql
FOR SELECT/INSERT/UPDATE  (auth.role() IN ('authenticated','service_role'));
FOR DELETE                (auth.role() = 'service_role');
```
append-only(`finance_audit_logs`·`review_decisions`·`review_decision_effects`·`source_parse_warnings`·`transaction_source_links`)는 UPDATE/DELETE 정책 없음.

### ⚠️ 실제 효력
1. **RLS 정책이 사실상 휴면.** 앱은 Supabase Auth 미사용(자체 HMAC 쿠키) → 브라우저에 `authenticated` JWT 부재 → anon 클라이언트 직접 조회는 전부 차단. 모든 데이터 접근은 서버 API(service_role, RLS 우회)만.
2. **법인격리 전무.** 어느 정책에도 `company_id` 조건 없음 → 회사 간 행 단위 격리 불가.
3. **Phase1 정책의 service_role 미명시**는 실무상 무해(service_role BYPASSRLS).

## 3. 원본성·데이터 무결성 (구현됨 ✅)
- 원본 파일 불변: `finance-raw` 비공개 버킷(4MB), 저장 후 미수정
- 재업로드 시 `source_file_id`·`source_row_number` 덮어쓰기 금지, `DUPLICATE_SOURCE` 링크로 기록
- SHA256 `file_content_hash`(파일) + `source_hash`(행) 이중 dedup
- Canonical 분리(`normalized_transactions`), 감사 append-only

## 4. 외부 전송 위험 (해당 없음 ✅)
- **외부 AI/LLM 미사용** — OpenAI/Anthropic 등 API 연동 전무 (`autoClassify.ts`의 'openai'/'chatgpt'는 키워드 분류 문자열일 뿐)
- 자연어 질의(Text-to-SQL) 계층 없음 → RESTRICTED 자료 외부 유출 벡터 없음

## 5. 승인 통제 (부분 🟡)
- `WRITE_OFF` 조정 확정: `process_review_decision` RPC에서 `p_actor_role != 'CEO'` 시 예외 → 단, actor_role은 앱이 주입(위조 가능성은 앱 계층 신뢰에 의존)
- `is_user_locked` obligation은 자동 재매칭·취소 차단

---

## P0 리스크 등급표

| 리스크 | 상태 | 방어선 현황 | 등급 |
|---|---|---|---|
| 실재무자료 외부 유출 | ✅ 낮음 | 외부 AI 미사용, 비공개 버킷 | P2 |
| 원본성 훼손 | ✅ 낮음 | 불변·dedup·Canonical 분리 | P2 |
| 권한 과조회 / 법인 간 열람 | ⬜ **높음** | RLS 휴면, company_id 격리 없음, 단일 관리자 | **P0** |
| 질의/접근 감사 부재 | 🟡 중간 | 시스템 이벤트 로그만, 조회 로그 없음 | P1 |
| actor_role 위조 | 🟡 중간 | 앱 계층 신뢰 의존, RLS 미강제 | P1 |
| 원본 파일 열람 통제 | 🟡 중간 | signed URL 미구현(현재 열람 경로 자체 없음) | P1 |

## 경영지원부/이명진 결정 필요사항
- [ ] Supabase Auth 도입 + `company_id` 기반 RLS로 법인격리 (P0)
- [ ] 역할 모델(CEO/FINANCE/VIEWER) 정식화 — actor_role을 신뢰 가능한 세션에서 도출
- [ ] 사용자 조회/로그인 AccessLog 도입 여부
- [ ] 원본 파일 열람 signed URL 정책(누가·얼마간·로그) 승인
- [ ] 실데이터 연결 시 등급 상향(RESTRICTED) 및 서지원 노출 범위 확정

_문서 끝 — RISK-FEEDAX P0 Security Review v0.1 / SECRET_
