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
 * Valid transitions mapping for Task State Machine
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
 * Checks if a transition from currentStatus to targetStatus is valid
 */
export function canTransition(currentStatus: TaskStatus, targetStatus: TaskStatus): boolean {
  if (currentStatus === targetStatus) {
    return true;
  }
  const allowed = VALID_TRANSITIONS[currentStatus];
  return allowed ? allowed.includes(targetStatus) : false;
}

/**
 * Validates transition or throws an error
 */
export function validateStatusTransition(currentStatus: TaskStatus, targetStatus: TaskStatus): void {
  if (!canTransition(currentStatus, targetStatus)) {
    throw new Error(
      `Invalid task status transition from '${currentStatus}' to '${targetStatus}'. Allowed transitions: [${
        VALID_TRANSITIONS[currentStatus]?.join(', ') || 'none'
      }]`
    );
  }
}
