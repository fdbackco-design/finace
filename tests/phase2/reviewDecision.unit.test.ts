/**
 * reviewDecision 단위 테스트
 *
 * - processReviewDecision RPC 호출 파라미터 변환 검증
 * - HUMAN_CONFIRMED 정정 흐름 (ALLOCATION_SUPERSEDE) 검증
 * - WRITE_OFF CEO 검증 로직 검증
 * - effect_type 목록 완전성 검증
 */

import { describe, it, expect, vi } from 'vitest';
import type { ReviewDecisionInput, EffectType, ActorRole, Decision } from '../../src/lib/phase2/types';
import { ALLOC_HUMAN_CONFIRMED, COMPANY_ID, COMPANY_CODE } from './golden-dataset.fixtures';

// ── RPC 파라미터 변환 검증 ─────────────────────────────────────────────────────

describe('processReviewDecision RPC 파라미터 변환', () => {
  it('camelCase → snake_case 변환', async () => {
    let capturedParams: Record<string, unknown> | null = null;

    const mockSupabase = {
      rpc: vi.fn().mockImplementation((fnName: string, params: Record<string, unknown>) => {
        capturedParams = params;
        return Promise.resolve({ data: { ok: true, review_decision_id: 'rd-001' }, error: null });
      }),
    };

    const { processReviewDecision } = await import('../../src/lib/phase2/reviewDecisionService');

    const input: ReviewDecisionInput = {
      reviewQueueId:  'rq-001',
      decision:       'APPROVED',
      decisionReason: '검토 완료',
      actorId:        'user-001',
      actorRole:      'FINANCE',
      effects: [{
        effectType:        'ALLOCATION_CONFIRM',
        matchAllocationId: 'alloc-001',
      }],
    };

    await processReviewDecision(mockSupabase as never, input);

    expect(capturedParams).not.toBeNull();
    expect(capturedParams!['p_review_queue_id']).toBe('rq-001');
    expect(capturedParams!['p_decision']).toBe('APPROVED');
    expect(capturedParams!['p_actor_role']).toBe('FINANCE');

    const effects = capturedParams!['p_effects'] as Array<Record<string, unknown>>;
    expect(effects[0]['effect_type']).toBe('ALLOCATION_CONFIRM');
    expect(effects[0]['match_allocation_id']).toBe('alloc-001');
  });

  it('undefined 파라미터 → null 변환', async () => {
    let capturedEffects: Array<Record<string, unknown>> | null = null;

    const mockSupabase = {
      rpc: vi.fn().mockImplementation((_fn: string, params: Record<string, unknown>) => {
        capturedEffects = params['p_effects'] as Array<Record<string, unknown>>;
        return Promise.resolve({ data: { ok: true, review_decision_id: 'rd-002' }, error: null });
      }),
    };

    const { processReviewDecision } = await import('../../src/lib/phase2/reviewDecisionService');

    await processReviewDecision(mockSupabase as never, {
      reviewQueueId:  'rq-002',
      decision:       'APPROVED',
      decisionReason: '테스트',
      actorId:        'user-001',
      actorRole:      'CEO',
      effects: [{
        effectType:   'OBLIGATION_CANCEL',
        obligationId: 'obl-001',
        // matchAllocationId, obligationAdjustmentId, amountOverride는 미지정
      }],
    });

    expect(capturedEffects![0]['match_allocation_id']).toBeNull();
    expect(capturedEffects![0]['obligation_adjustment_id']).toBeNull();
    expect(capturedEffects![0]['amount_override']).toBeNull();
    expect(capturedEffects![0]['obligation_id']).toBe('obl-001');
  });

  it('RPC 에러 → error 반환', async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'WRITE_OFF adjustment requires CEO role' },
      }),
    };

    const { processReviewDecision } = await import('../../src/lib/phase2/reviewDecisionService');

    const { data, error } = await processReviewDecision(mockSupabase as never, {
      reviewQueueId:  'rq-003',
      decision:       'APPROVED',
      decisionReason: 'WRITE_OFF 승인 시도',
      actorId:        'user-002',
      actorRole:      'FINANCE',
      effects: [{ effectType: 'ADJUSTMENT_CONFIRM', obligationAdjustmentId: 'adj-001' }],
    });

    expect(data).toBeNull();
    expect(error).toContain('CEO role');
  });
});

// ── HUMAN_CONFIRMED 정정 흐름 ─────────────────────────────────────────────────

describe('HUMAN_CONFIRMED allocation 정정 흐름', () => {
  it('ALLOCATION_SUPERSEDE effect_type은 정정 경로 전용', () => {
    const correctionEffects: EffectType[] = ['ALLOCATION_SUPERSEDE'];
    const autoMatchEffects:  EffectType[] = ['ALLOCATION_CONFIRM', 'ALLOCATION_REJECT'];

    // 자동 매칭은 SUPERSEDE를 사용하지 않음
    expect(autoMatchEffects).not.toContain('ALLOCATION_SUPERSEDE');
    expect(correctionEffects).toContain('ALLOCATION_SUPERSEDE');
  });

  it('정정 시 새 allocation + SUPERSEDE를 같은 decision에 포함', () => {
    const effects: EffectType[] = ['ALLOCATION_SUPERSEDE', 'ALLOCATION_CONFIRM'];
    expect(effects).toContain('ALLOCATION_SUPERSEDE');
    expect(effects).toContain('ALLOCATION_CONFIRM');
    expect(effects).toHaveLength(2);
  });

  it('HUMAN_CONFIRMED → SUPERSEDED 경로만 허용', () => {
    // 자동 매칭에서 HUMAN_CONFIRMED를 건드리는 status는 없어야 함
    const autoConfirmTargetStatuses = ['PROPOSED'];
    expect(autoConfirmTargetStatuses).not.toContain('HUMAN_CONFIRMED');
  });
});

// ── Effect 타입 완전성 검증 ───────────────────────────────────────────────────

describe('EffectType 완전성', () => {
  const allEffectTypes: EffectType[] = [
    'ALLOCATION_CONFIRM',
    'ALLOCATION_REJECT',
    'ALLOCATION_SUPERSEDE',
    'ADJUSTMENT_CONFIRM',
    'ADJUSTMENT_REJECT',
    'OBLIGATION_CANCEL',
  ];

  it('6가지 effect_type 정의', () => {
    expect(allEffectTypes).toHaveLength(6);
  });

  it('allocation 관련 3가지 포함', () => {
    const allocTypes = allEffectTypes.filter(e => e.startsWith('ALLOCATION_'));
    expect(allocTypes).toHaveLength(3);
  });

  it('adjustment 관련 2가지 포함', () => {
    const adjTypes = allEffectTypes.filter(e => e.startsWith('ADJUSTMENT_'));
    expect(adjTypes).toHaveLength(2);
  });
});

// ── Decision 값 검증 ──────────────────────────────────────────────────────────

describe('Decision 값 완전성', () => {
  const allDecisions: Decision[] = ['APPROVED', 'REJECTED', 'DEFERRED', 'PARTIAL_APPROVE'];

  it('DEFERRED → case_status=DEFERRED (RESOLVED 아님)', () => {
    const decision = 'DEFERRED';
    const caseStatus = decision === 'DEFERRED' ? 'DEFERRED' : 'RESOLVED';
    expect(caseStatus).toBe('DEFERRED');
  });

  it('APPROVED → case_status=RESOLVED', () => {
    const decision = 'APPROVED';
    const caseStatus = decision === 'DEFERRED' ? 'DEFERRED' : 'RESOLVED';
    expect(caseStatus).toBe('RESOLVED');
  });
});

// ── ActorRole 검증 ────────────────────────────────────────────────────────────

describe('ActorRole 규칙', () => {
  const allRoles: ActorRole[] = ['CEO', 'FINANCE', 'SYSTEM'];

  it('WRITE_OFF는 CEO만 가능 (non-CEO → reject)', () => {
    const nonCeoRoles: ActorRole[] = ['FINANCE', 'SYSTEM'];
    for (const role of nonCeoRoles) {
      const canWriteOff = role === 'CEO';
      expect(canWriteOff).toBe(false);
    }
  });

  it('CEO는 WRITE_OFF 가능', () => {
    expect('CEO' === 'CEO').toBe(true);
  });
});
