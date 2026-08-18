import { z } from 'zod';

export const TaskStatusSchema = z.enum([
  'CREATED',
  'LOADING_CONTEXT',
  'ANALYZING',
  'PLANNING',
  'CODING',
  'VERIFYING',
  'REVIEWING',
  'FIXING',
  'FINALIZING',
  'DONE',
  'WAITING_FOR_CONTEXT',
  'WAITING_FOR_APPROVAL',
  'NEED_ARBITRATION',
  'BLOCKED',
  'FAILED',
  'CANCELLED',
]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/**
 * 任务状态机合法流转规则表
 */
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  CREATED: ['LOADING_CONTEXT', 'ANALYZING', 'CANCELLED', 'FAILED'],
  LOADING_CONTEXT: ['ANALYZING', 'WAITING_FOR_CONTEXT', 'CANCELLED', 'FAILED'],
  ANALYZING: ['PLANNING', 'CODING', 'WAITING_FOR_APPROVAL', 'CANCELLED', 'FAILED'],
  PLANNING: ['CODING', 'WAITING_FOR_APPROVAL', 'CANCELLED', 'FAILED'],
  CODING: ['VERIFYING', 'BLOCKED', 'CANCELLED', 'FAILED'],
  VERIFYING: ['REVIEWING', 'FINALIZING', 'FIXING', 'BLOCKED', 'CANCELLED', 'FAILED'],
  REVIEWING: ['FINALIZING', 'FIXING', 'NEED_ARBITRATION', 'CANCELLED', 'FAILED'],
  FIXING: ['VERIFYING', 'BLOCKED', 'CANCELLED', 'FAILED'],
  FINALIZING: ['DONE', 'CANCELLED', 'FAILED'],
  DONE: [],
  WAITING_FOR_CONTEXT: ['LOADING_CONTEXT', 'ANALYZING', 'CANCELLED', 'FAILED'],
  WAITING_FOR_APPROVAL: ['PLANNING', 'CODING', 'FINALIZING', 'CANCELLED', 'FAILED'],
  NEED_ARBITRATION: ['FIXING', 'FINALIZING', 'CANCELLED', 'FAILED'],
  BLOCKED: ['LOADING_CONTEXT', 'ANALYZING', 'PLANNING', 'CODING', 'FIXING', 'CANCELLED', 'FAILED'],
  FAILED: [],
  CANCELLED: [],
};

/**
 * 检查是否允许从 currentStatus 流转到 targetStatus
 */
export function canTransition(currentStatus: TaskStatus, targetStatus: TaskStatus): boolean {
  if (currentStatus === targetStatus) {
    return true;
  }
  const allowed = VALID_TRANSITIONS[currentStatus];
  return allowed ? allowed.includes(targetStatus) : false;
}

/**
 * 校验状态流转合法性，不合法时抛出中文提示
 */
export function validateStatusTransition(currentStatus: TaskStatus, targetStatus: TaskStatus): void {
  if (!canTransition(currentStatus, targetStatus)) {
    throw new Error(
      `非法的任务状态流转：无法从当前状态 '${currentStatus}' 流转至目标状态 '${targetStatus}'。当前允许的后续状态为：[${
        VALID_TRANSITIONS[currentStatus]?.join(', ') || '无'
      }]`
    );
  }
}
