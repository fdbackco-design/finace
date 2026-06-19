-- ==========================================================
-- seed.sql — 초기 마스터 데이터
-- 실행 순서: 001_init_finance_schema.sql 실행 후 실행
-- ==========================================================

-- ==========================================================
-- 1. companies (3개 회사)
-- ==========================================================
INSERT INTO companies (name, company_code, business_no) VALUES
  ('피드백', 'feedback',  '296-87-03628'),
  ('상생',   'sangsaeng', '884-81-03587'),
  ('슛문',   'shootmoon', '519-09-02179')
ON CONFLICT (company_code) DO UPDATE
  SET name        = EXCLUDED.name,
      business_no = EXCLUDED.business_no;

-- ==========================================================
-- 2. fixed_cost_rules (고정비캘린더 — goal.xlsx 기준)
-- ==========================================================
-- company_id 서브쿼리로 자동 매핑

-- 피드백
INSERT INTO fixed_cost_rules
  (company_id, company_code, payment_day, category, vendor_name, amount, vendor_alias, match_key, account_no_str, payment_type, vat_type, is_card_bill)
VALUES
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 1,  '지급수수료', '리드경영 컨설팅비',          1100000,  '리드엠에스씨',      '431-61-00525, 김믿음, leadbzcenter@naver.com, 010-3026-6007',   '하나 121-910018-31804 김믿음', '계좌_송금', '세금계산서/부포', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 2,  '임차료',     '송도트리플3 신진혁 임차료',    880000,   '송도트리플3',       '238-25-00952, 홍선미, sunmi47@naver.com',                         '우리 1002-248-652584 홍선미',  '계좌_송금', '세금계산서/부포', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 7,  '지급수수료', '구글 프로그램 구독',           150000,   '구글',              '디자이너사용, 개발자사용 프로그램',                               null,                          '카드_자동결제', '카드결제', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 10, '급여',       '피드백 급여',                 21377090, '임직원',            '임직원',                                                         '직원계좌',                     '계좌_송금', null, false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 10, '예수금',     '원천세',                      1270000,  '세무서,구청',       '032-670-9200, 032-749-7114',                                     '납부전용계좌',                 '계좌_송금', '영수증', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 10, '보험(복리후생비)', '4대보험',                4745500,  '건강보험공단',      '1577-1000',                                                      null,                          '계좌_자동이체', '납부증명서', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 10, '복리후생',   '직원식대',                    500000,   '쉐프의 밥상',       '592-54-00991, 정영길, gonenana11@naver.com, 0507-1353-5188',    '기업 095-502659-01-016 정영길', '계좌_송금', '세금계산서/부포', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 18, '관리비',     'AT센터 정기주차',             30000,    '송도테크노파크IT센터관리단', '120-82-68348, 이상철, songdoit2097501@naver.com, 032-209-7503', '기업 472-056-895-04-026 송도IT센터', '계좌_송금', '세금계산서/부포', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 17, '지급수수료', 'GPT',                         33950,    'CHATGPT',           'AI 서비스 구독 계정: 개인 구글 계정 이명진실장',                 null,                          '카드_자동결제', '카드결제', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 20, '카드',       '피드백 우리카드',              0,        '우리카드',          '101-86-79070, 1588-9955',                                        null,                          '계좌_자동이체', '카드명세', true),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 20, '임차료',     'IM캐피탈(피드백)',             1119100,  '(주)iM캐피탈',      '220-87-87408, 김성욱, noreply@imcap.co.kr, 1566-0050',          null,                          '계좌_자동이체', '계산서/공급가액', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 21, '카드',       '피드백 기업카드',              0,        '비씨카드',          '214-81-37726, 김영우, 1588-4000',                                null,                          '계좌_자동이체', '카드명세', true),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 23, '지급수수료', '어도비 구독',                 104000,   'adobe',             'adobe 구독 계정: fdbackco@gmail.com',                             null,                          '카드_자동결제', '카드결제', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 22, '통신비',     'SKT',                         50175,    'SK브로드밴드',      '214-86-18758, 김성수, cyber@skbroadband.com, 1600-0108',         null,                          '계좌_자동이체', '세금계산서/부포', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 24, '지급수수료', 'GPT 구독(대표님)',             298800,   'CHATGPT',           'AI 서비스 구독 계정: 개인 구글 계정 송대표님',                   null,                          '카드_자동결제', '카드결제', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 28, '지급수수료', '세무사사무실(피드백)',         143000,   '세무회계 청솔',     '611-17-01170, 홍진욱, maverick8535@naver.com, 010-2107-3705',   null,                          '계좌_자동이체', '세금계산서/부포', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 31, '이자비용',   '우리은행 이자',               400000,   '우리은행',          '우리은행 이자 자동 출금',                                        null,                          '계좌_자동이체', '이자계산서', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 31, '관리비',     '트리플타워 4대 지정주차',     80000,    '준토스핏',          '전제호, 010-4485-1973',                                          '국민 285102-04-195048 전제호',  '계좌_송금', '계산서 없음', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 31, '통신비',     'LGU+',                        15930,    '엘지유플러스',      '220-81-39938, 홍범식, lguplus_billing@lguplus.co.kr, 1544-0010', null,                         '계좌_자동이체', '세금계산서/부포', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 31, '임차료',     '아메리칸타운 손성훈 임차료',  1320000,  '시가케이 건대점',   '206-32-13477, 강성현, neoseven@naver.com, 010-8968-0717',        '우리 1002 254 464094 강성현',  '계좌_송금', '세금계산서/부포', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 31, '관리비',     '피드백 사무실',               800000,   '하늘 ENG',          '239-17-00208, 한기현외1명, minewoo@hanmail.net, 010-3729-5628',  '우리 1005-502-960175 한기현',  '계좌_송금', '세금계산서/부포', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 31, '수도광열비', '피드백 사무실',               100000,   '하늘 ENG',          '239-17-00208, 한기현외1명, minewoo@hanmail.net, 010-3729-5628',  '우리 1005-502-960175 한기현',  '계좌_송금', '계산서/공급가액', false),
  ((SELECT id FROM companies WHERE company_code='feedback'), 'feedback', 31, '임차료',     '피드백 사무실',               3080000,  '하늘 ENG',          '239-17-00208, 한기현외1명, minewoo@hanmail.net, 010-3729-5628',  '우리 1005-502-960175 한기현',  '계좌_송금', '세금계산서/부포', false),

-- 상생
  ((SELECT id FROM companies WHERE company_code='sangsaeng'), 'sangsaeng', 10, '급여',     '상생 급여',                  13251383, '임직원',           '임직원',                                                         '직원계좌',                    '계좌_송금', null, false),
  ((SELECT id FROM companies WHERE company_code='sangsaeng'), 'sangsaeng', 10, '예수금',   '원천세',                     510000,   '세무서,구청',      '032-670-9200, 032-749-7114',                                     '납부전용계좌',                '계좌_송금', '영수증', false),
  ((SELECT id FROM companies WHERE company_code='sangsaeng'), 'sangsaeng', 10, '보험(복리후생비)', '4대보험',            3315460,  '건강보험공단',     '1577-1000',                                                      null,                         '계좌_자동이체', '납부증명서', false),
  ((SELECT id FROM companies WHERE company_code='sangsaeng'), 'sangsaeng', 17, '카드',     '상생 우리카드',              0,        '우리카드',         '101-86-79070, 1588-9955',                                        null,                         '계좌_자동이체', '카드명세', true),
  ((SELECT id FROM companies WHERE company_code='sangsaeng'), 'sangsaeng', 17, '임차료',   'AIT 이명진 임차료',          935000,   '에이아이티센터 2409호', '750-18-01905, 구본혁, epddl19@naver.com',                   '토스 1000-2179-9716 구본혁',  '계좌_송금', '세금계산서/부포', false),
  ((SELECT id FROM companies WHERE company_code='sangsaeng'), 'sangsaeng', 17, '지급수수료', 'GPT',                      33536,    'CHATGPT',          'AI 서비스 구독 계정: 상생 구글 계정',                            null,                         '카드_자동결제', '카드결제', false),
  ((SELECT id FROM companies WHERE company_code='sangsaeng'), 'sangsaeng', 20, '렌탈',     '쿠쿠정수기(상생)',           46900,    '쿠쿠홈시스주식회사', '590-87-00993, 구본학, rental_tax@cuckoo.co.kr, 1577-0010',     null,                         '계좌_자동이체', '세금계산서/부포', false),
  ((SELECT id FROM companies WHERE company_code='sangsaeng'), 'sangsaeng', 22, '임차료',   '아메리칸타운 대표님 임차료', 1800000,  '조동운',           '아메리칸타운더샵공인중개사무소',                                 '농협 302-1364-5627-31 조동훈', '계좌_송금', '계산서 없음', false),
  ((SELECT id FROM companies WHERE company_code='sangsaeng'), 'sangsaeng', 22, '임차료',   '메리츠캐피탈(상생)',         612760,   '메리츠캐피탈',     '107-87-67865, 권태길, 1588-9666',                                null,                         '계좌_자동이체', '세금계산서/부포', false),
  ((SELECT id FROM companies WHERE company_code='sangsaeng'), 'sangsaeng', 25, '카드',     '상생 기업카드',              0,        '비씨카드',         '214-81-37726, 김영우, 1588-4000',                                null,                         '계좌_자동이체', '카드명세', true),
  ((SELECT id FROM companies WHERE company_code='sangsaeng'), 'sangsaeng', 28, '지급수수료', '세무사사무실(상생)',         143000,  '세무회계 청솔',    '611-17-01170, 홍진욱, maverick8535@naver.com, 010-2107-3705',    null,                         '계좌_자동이체', '세금계산서/부포', false),

-- 슛문
  ((SELECT id FROM companies WHERE company_code='shootmoon'), 'shootmoon', 10, '급여',     '슛문 급여',                  3000000,  '안성준',           '안성준 이사',                                                    '카카오 3333087139667 안성준',  '계좌_송금', null, false)
;
