export class SecretRedactor {
  private static readonly PATTERNS: Array<{ regex: RegExp; replace: string }> = [
    // Authorization: Bearer / Basic
    {
      regex: /(authorization\s*:\s*(?:bearer|basic)\s+)[a-zA-Z0-9_\-\.\+/=]+/gi,
      replace: '$1[REDACTED]',
    },
    // Bearer token alone
    {
      regex: /(bearer\s+)[a-zA-Z0-9_\-\.]{16,}/gi,
      replace: '$1[REDACTED]',
    },
    // OpenAI / Gemini / GitHub / Anthropic typical keys
    {
      regex: /\b(sk-(?:proj-|ant-|live-)?[a-zA-Z0-9_\-]{20,})\b/g,
      replace: '[REDACTED]',
    },
    {
      regex: /\b(gh[pousr]_[a-zA-Z0-9]{20,})\b/g,
      replace: '[REDACTED]',
    },
    // Key-value pairs in text / JSON (e.g. apiKey="...", password=...)
    {
      regex: /((?:api_?key|access_?token|refresh_?token|client_?secret|secret_?key|password|passwd|auth_?token)[\s"':=]+)[^\s"',;&}\]]{4,}/gi,
      replace: '$1[REDACTED]',
    },
    // Connection strings containing passwords (postgres://user:pass@host)
    {
      regex: /((?:postgres|mysql|mongodb(?:\+srv)?|redis):\/\/[^:]+:)[^@]+(@)/gi,
      replace: '$1[REDACTED]$2',
    },
  ];

  /**
   * Redacts sensitive secrets from a string.
   */
  static redactText(text: string): string {
    if (!text || typeof text !== 'string') {
      return text;
    }

    let result = text;

    // 1. Regex replacements
    for (const { regex, replace } of this.PATTERNS) {
      result = result.replace(regex, replace);
    }

    // 2. Known sensitive environment variable values
    result = this.redactEnvValues(result);

    return result;
  }

  /**
   * Deeply redacts sensitive strings and sensitive object keys in objects or arrays.
   */
  static redactObject<T>(input: T): T {
    if (input === null || input === undefined) {
      return input;
    }

    if (typeof input === 'string') {
      return this.redactText(input) as unknown as T;
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.redactObject(item)) as unknown as T;
    }

    if (typeof input === 'object') {
      if (input instanceof Date || input instanceof RegExp) {
        return input;
      }

      const copy: Record<string, unknown> = {};
      const sensitiveKeys = [
        'apikey',
        'api_key',
        'token',
        'access_token',
        'refresh_token',
        'password',
        'passwd',
        'secret',
        'client_secret',
        'secret_key',
        'authorization',
      ];

      for (const [key, value] of Object.entries(input)) {
        const lowerKey = key.toLowerCase();
        if (sensitiveKeys.some((s) => lowerKey.includes(s)) && typeof value === 'string') {
          copy[key] = '[REDACTED]';
        } else {
          copy[key] = this.redactObject(value);
        }
      }
      return copy as T;
    }

    return input;
  }

  /**
   * Redacts error message and stack trace.
   */
  static redactError(err: unknown): unknown {
    if (err instanceof Error) {
      err.message = this.redactText(err.message);
      if (err.stack) {
        err.stack = this.redactText(err.stack);
      }
      return err;
    }
    if (typeof err === 'string') {
      return this.redactText(err);
    }
    return err;
  }

  private static redactEnvValues(text: string): string {
    const sensitiveEnvKeys = [
      'KEY',
      'TOKEN',
      'SECRET',
      'PASSWORD',
      'PASS',
      'AUTH',
      'CREDENTIAL',
    ];

    if (typeof process !== 'undefined' && process.env) {
      for (const [envKey, envVal] of Object.entries(process.env)) {
        if (!envVal || envVal.length < 8) continue;
        const upper = envKey.toUpperCase();
        if (sensitiveEnvKeys.some((s) => upper.includes(s))) {
          // Avoid replacing if text doesn't include it
          if (text.includes(envVal)) {
            text = text.replaceAll(envVal, '[REDACTED]');
          }
        }
      }
    }
    return text;
  }
}
