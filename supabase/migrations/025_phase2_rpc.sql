-- ==========================================================
-- 025_phase2_rpc.sql
-- Phase 2A: 검토 결정 원자적 처리 RPC
--
-- process_review_decision():
--   review_decision + review_decision_effects +
--   allocation/adjustment 상태 변경 + finance_audit_logs
--   → 단일 DB 트랜잭션으로 원자적 처리
--
-- 호출:
--   SELECT process_review_decision(
--     p_review_queue_id,
--     p_decision,
--     p_decision_reason,
--     p_actor_id,
--     p_actor_role,
--     p_effects   -- JSONB array
--   );
--
-- p_effects 예시:
--   '[
--     {"effect_type":"ALLOCATION_CONFIRM","match_allocation_id":"uuid1"},
--     {"effect_type":"ADJUSTMENT_CONFIRM","obligation_adjustment_id":"uuid2"}
--   ]'
-- ==========================================================

CREATE OR REPLACE FUNCTION process_review_decision(
  p_review_queue_id  uuid,
  p_decision         text,
  p_decision_reason  text,
  p_actor_id         text,
  p_actor_role       text,
  p_effects          jsonb   -- array of effect objects
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_decision_id     uuid;
  v_company_id      uuid;
  v_company_code    text;
  v_effect          jsonb;
  v_effect_type     text;
  v_alloc_id        uuid;
  v_adj_id          uuid;
  v_obl_id          uuid;
  v_amount_override bigint;
  v_rows_affected   int;
BEGIN
  -- 검증: review_queue 존재 및 처리 가능 상태
  SELECT rq.company_id, c.company_code
  INTO v_company_id, v_company_code
  FROM review_queue rq
  JOIN companies c ON c.id = rq.company_id
  WHERE rq.id = p_review_queue_id
    AND rq.case_status IN ('PENDING', 'IN_REVIEW');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'review_queue not found or already resolved: %', p_review_queue_id;
  END IF;

  -- 검증: p_decision 값
  IF p_decision NOT IN ('APPROVED', 'REJECTED', 'DEFERRED', 'PARTIAL_APPROVE') THEN
    RAISE EXCEPTION 'Invalid decision value: %', p_decision;
  END IF;

  -- 검증: p_actor_role 값
  IF p_actor_role NOT IN ('CEO', 'FINANCE', 'SYSTEM') THEN
    RAISE EXCEPTION 'Invalid actor_role value: %', p_actor_role;
  END IF;

  -- WRITE_OFF 조정 확인 시 CEO 검증
  FOR v_effect IN SELECT * FROM jsonb_array_elements(p_effects)
  LOOP
    IF (v_effect->>'effect_type') = 'ADJUSTMENT_CONFIRM' THEN
      v_adj_id := (v_effect->>'obligation_adjustment_id')::uuid;
      IF EXISTS (
        SELECT 1 FROM obligation_adjustments
        WHERE id = v_adj_id AND adjustment_type = 'WRITE_OFF'
      ) AND p_actor_role != 'CEO' THEN
        RAISE EXCEPTION 'WRITE_OFF adjustment requires CEO role. actor_role: %', p_actor_role;
      END IF;
    END IF;
  END LOOP;

  -- 1. review_decision INSERT
  INSERT INTO review_decisions (
    review_queue_id,
    company_id,
    decision,
    decision_reason,
    actor_id,
    actor_role,
    decided_at
  ) VALUES (
    p_review_queue_id,
    v_company_id,
    p_decision,
    p_decision_reason,
    p_actor_id,
    p_actor_role,
    now()
  ) RETURNING id INTO v_decision_id;

  -- 2. effects 처리
  FOR v_effect IN SELECT * FROM jsonb_array_elements(p_effects)
  LOOP
    v_effect_type     := v_effect->>'effect_type';
    v_alloc_id        := (v_effect->>'match_allocation_id')::uuid;
    v_adj_id          := (v_effect->>'obligation_adjustment_id')::uuid;
    v_obl_id          := (v_effect->>'obligation_id')::uuid;
    v_amount_override := (v_effect->>'amount_override')::bigint;

    -- 2a. review_decision_effects INSERT
    INSERT INTO review_decision_effects (
      review_decision_id,
      effect_type,
      match_allocation_id,
      obligation_adjustment_id,
      obligation_id,
      amount_override
    ) VALUES (
      v_decision_id,
      v_effect_type,
      v_alloc_id,
      v_adj_id,
      v_obl_id,
      v_amount_override
    );

    -- 2b. 상태 변경 적용
    CASE v_effect_type

      WHEN 'ALLOCATION_CONFIRM' THEN
        UPDATE match_allocations
        SET
          allocation_status  = 'HUMAN_CONFIRMED',
          review_decision_id = v_decision_id,
          allocated_amount   = COALESCE(v_amount_override, allocated_amount),
          updated_at         = now()
        WHERE id = v_alloc_id
          AND allocation_status = 'PROPOSED';
        GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
        IF v_rows_affected = 0 THEN
          RAISE EXCEPTION 'ALLOCATION_CONFIRM: allocation not found or not PROPOSED: %', v_alloc_id;
        END IF;

      WHEN 'ALLOCATION_REJECT' THEN
        UPDATE match_allocations
        SET
          allocation_status = 'REJECTED',
          updated_at        = now()
        WHERE id = v_alloc_id
          AND allocation_status IN ('PROPOSED', 'AUTO_CONFIRMED');
        GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
        IF v_rows_affected = 0 THEN
          RAISE EXCEPTION 'ALLOCATION_REJECT: allocation not found or not rejectable: %', v_alloc_id;
        END IF;

      WHEN 'ALLOCATION_SUPERSEDE' THEN
        -- 정정 경로 전용: HUMAN_CONFIRMED allocation을 SUPERSEDED 처리
        UPDATE match_allocations
        SET
          allocation_status = 'SUPERSEDED',
          updated_at        = now()
        WHERE id = v_alloc_id
          AND allocation_status IN ('PROPOSED', 'AUTO_CONFIRMED', 'HUMAN_CONFIRMED');
        GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
        IF v_rows_affected = 0 THEN
          RAISE EXCEPTION 'ALLOCATION_SUPERSEDE: allocation not found: %', v_alloc_id;
        END IF;

      WHEN 'ADJUSTMENT_CONFIRM' THEN
        UPDATE obligation_adjustments
        SET
          status             = 'HUMAN_CONFIRMED',
          review_decision_id = v_decision_id,
          updated_at         = now()
        WHERE id = v_adj_id
          AND status = 'PROPOSED';
        GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
        IF v_rows_affected = 0 THEN
          RAISE EXCEPTION 'ADJUSTMENT_CONFIRM: adjustment not found or not PROPOSED: %', v_adj_id;
        END IF;

      WHEN 'ADJUSTMENT_REJECT' THEN
        UPDATE obligation_adjustments
        SET
          status     = 'REJECTED',
          updated_at = now()
        WHERE id = v_adj_id
          AND status = 'PROPOSED';
        GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
        IF v_rows_affected = 0 THEN
          RAISE EXCEPTION 'ADJUSTMENT_REJECT: adjustment not found or not PROPOSED: %', v_adj_id;
        END IF;

      WHEN 'OBLIGATION_CANCEL' THEN
        -- is_user_locked 검증
        IF EXISTS (SELECT 1 FROM obligations WHERE id = v_obl_id AND is_user_locked = true) THEN
          RAISE EXCEPTION 'OBLIGATION_CANCEL: obligation is user_locked: %', v_obl_id;
        END IF;
        UPDATE obligations
        SET
          is_cancelled    = true,
          cancelled_at    = now(),
          cancelled_reason = p_decision_reason,
          updated_at      = now()
        WHERE id = v_obl_id
          AND is_cancelled = false;
        GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
        IF v_rows_affected = 0 THEN
          RAISE EXCEPTION 'OBLIGATION_CANCEL: obligation not found or already cancelled: %', v_obl_id;
        END IF;

      ELSE
        RAISE EXCEPTION 'Unknown effect_type: %', v_effect_type;
    END CASE;
  END LOOP;

  -- 3. review_queue 상태 업데이트
  UPDATE review_queue
  SET
    case_status  = CASE WHEN p_decision = 'DEFERRED' THEN 'DEFERRED' ELSE 'RESOLVED' END,
    resolved_at  = CASE WHEN p_decision != 'DEFERRED' THEN now() ELSE NULL END,
    updated_at   = now()
  WHERE id = p_review_queue_id;

  -- 4. finance_audit_logs 기록
  INSERT INTO finance_audit_logs (
    company_id,
    company_code,
    entity_type,
    entity_id,
    action_type,
    after_json,
    reason,
    actor_id
  ) VALUES (
    v_company_id,
    v_company_code,
    'review_decision',
    v_decision_id,
    'REVIEW_DECISION_RECORDED',
    jsonb_build_object(
      'review_queue_id',  p_review_queue_id,
      'decision',         p_decision,
      'effects_count',    jsonb_array_length(p_effects),
      'effects',          p_effects
    ),
    p_decision_reason,
    p_actor_id
  );

  RETURN jsonb_build_object(
    'ok',                 true,
    'review_decision_id', v_decision_id
  );

EXCEPTION
  WHEN OTHERS THEN
    -- 전체 롤백 (PostgreSQL 트랜잭션 자동 롤백)
    RAISE;
END;
$$;

-- ── 검증 SQL ─────────────────────────────────────────────────────────────────
-- SELECT process_review_decision(
--   '<review_queue_id>',
--   'APPROVED',
--   '테스트 승인',
--   'test_user',
--   'CEO',
--   '[{"effect_type":"ALLOCATION_CONFIRM","match_allocation_id":"<id>"}]'
-- );

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS process_review_decision(uuid, text, text, text, text, jsonb);
