import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ProjectPathGuard, ProjectPathGuardError } from '../src/security/project-path-guard.js';
import { ProcessCommandGuard, ProcessCommandGuardError } from '../src/security/process-command-guard.js';
import { SecretRedactor } from '../src/security/secret-redactor.js';

describe('ProjectPathGuard', () => {
  const root = path.resolve(process.cwd());

  it('should allow valid relative paths within projectRoot', () => {
    const valid = ProjectPathGuard.validatePath(root, 'src/index.ts');
    expect(valid).toBe(path.resolve(root, 'src/index.ts'));
    expect(ProjectPathGuard.isSafePath(root, 'src/index.ts')).toBe(true);
  });

  it('should allow nested subdirectories', () => {
    const valid = ProjectPathGuard.validatePath(root, 'src/mastra/workflows/software-development.ts');
    expect(valid).toBe(path.resolve(root, 'src/mastra/workflows/software-development.ts'));
  });

  it('should throw ProjectPathGuardError on ../ path traversal', () => {
    expect(() => ProjectPathGuard.validatePath(root, '../outside.txt')).toThrow(ProjectPathGuardError);
    expect(ProjectPathGuard.isSafePath(root, '../outside.txt')).toBe(false);
  });

  it('should throw ProjectPathGuardError on multi-level ../../ traversal', () => {
    expect(() => ProjectPathGuard.validatePath(root, 'src/../../../../secret.key')).toThrow(ProjectPathGuardError);
  });

  it('should throw ProjectPathGuardError on absolute path outside root', () => {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\System32\\calc.exe' : '/etc/passwd';
    expect(() => ProjectPathGuard.validatePath(root, outside)).toThrow(ProjectPathGuardError);
  });

  it('should prevent similar prefix path deception', () => {
    const fakeRoot = path.join(root, 'demo');
    const deceptivePath = path.join(root, 'demo-fake', 'file.txt');
    expect(() => ProjectPathGuard.validatePath(fakeRoot, deceptivePath)).toThrow(ProjectPathGuardError);
  });
});

describe('ProcessCommandGuard', () => {
  it('should classify safe development commands as SAFE', () => {
    expect(ProcessCommandGuard.evaluate('git status').level).toBe('SAFE');
    expect(ProcessCommandGuard.evaluate('git diff').level).toBe('SAFE');
    expect(ProcessCommandGuard.evaluate('npm test').level).toBe('SAFE');
    expect(ProcessCommandGuard.evaluate('vitest run').level).toBe('SAFE');
    expect(ProcessCommandGuard.evaluate('echo hello').level).toBe('SAFE');
  });

  it('should classify destructive system commands as DENIED', () => {
    expect(ProcessCommandGuard.evaluate('rm -rf /').level).toBe('DENIED');
    expect(ProcessCommandGuard.evaluate('format c:').level).toBe('DENIED');
    expect(ProcessCommandGuard.evaluate('diskpart').level).toBe('DENIED');
    expect(ProcessCommandGuard.evaluate('shutdown').level).toBe('DENIED');
    expect(ProcessCommandGuard.evaluate('DROP TABLE users').level).toBe('DENIED');
    expect(ProcessCommandGuard.evaluate('git push origin main --force').level).toBe('DENIED');
  });

  it('should classify risky commands as APPROVAL_REQUIRED', () => {
    expect(ProcessCommandGuard.evaluate('rm -rf node_modules').level).toBe('APPROVAL_REQUIRED');
    expect(ProcessCommandGuard.evaluate('git reset --hard HEAD~1').level).toBe('APPROVAL_REQUIRED');
    expect(ProcessCommandGuard.evaluate('npm publish').level).toBe('APPROVAL_REQUIRED');
  });

  it('should respect custom allow and deny configurations', () => {
    const customConfig = {
      allow: ['npm publish --dry-run'],
      deny: ['curl evil.com'],
    };

    expect(ProcessCommandGuard.evaluate('npm publish --dry-run', customConfig).level).toBe('SAFE');
    expect(ProcessCommandGuard.evaluate('curl evil.com', customConfig).level).toBe('DENIED');
  });

  it('assertExecutable should throw ProcessCommandGuardError for non-safe commands', () => {
    expect(() => ProcessCommandGuard.assertExecutable('format d:')).toThrow(ProcessCommandGuardError);
  });
});

describe('SecretRedactor', () => {
  it('should redact Bearer authorization tokens', () => {
    const text = 'Headers: { Authorization: Bearer abcdef1234567890abcdef }';
    const redacted = SecretRedactor.redactText(text);
    expect(redacted).toContain('Authorization: Bearer [REDACTED]');
    expect(redacted).not.toContain('abcdef1234567890abcdef');
  });

  it('should redact sk- and ghp- API keys', () => {
    const text = 'OpenAI Key: sk-proj-1234567890123456789012345, GitHub: ghp_1234567890123456789012345';
    const redacted = SecretRedactor.redactText(text);
    expect(redacted).not.toContain('sk-proj-1234567890123456789012345');
    expect(redacted).not.toContain('ghp_1234567890123456789012345');
    expect(redacted).toContain('[REDACTED]');
  });

  it('should deeply redact sensitive object keys and values', () => {
    const payload = {
      username: 'admin',
      password: 'super_secret_password',
      apiKey: 'sk-live-99887766554433221100',
      nested: {
        accessToken: 'xyz_token_secret_123',
        description: 'safe message',
      },
    };

    const redacted = SecretRedactor.redactObject(payload);
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.apiKey).toBe('[REDACTED]');
    expect(redacted.nested.accessToken).toBe('[REDACTED]');
    expect(redacted.username).toBe('admin');
    expect(redacted.nested.description).toBe('safe message');
  });

  it('should redact Error messages and stack traces', () => {
    const err = new Error('Failed to connect with password=my_db_password_123');
    const redactedErr = SecretRedactor.redactError(err) as Error;
    expect(redactedErr.message).toContain('password=[REDACTED]');
    expect(redactedErr.message).not.toContain('my_db_password_123');
  });
});
