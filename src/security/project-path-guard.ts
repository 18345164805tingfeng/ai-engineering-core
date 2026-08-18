import fs from 'node:fs';
import path from 'node:path';

export class ProjectPathGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectPathGuardError';
  }
}

export class ProjectPathGuard {
  /**
   * 校验目标路径是否严格位于 projectRoot 项目根目录内部。
   * 若越界则抛出 ProjectPathGuardError 中文错误提示。
   * 返回标准化后的绝对目标路径。
   */
  static validatePath(projectRoot: string, targetPath: string): string {
    if (!projectRoot) {
      throw new ProjectPathGuardError('项目根目录（projectRoot）不能为空。');
    }
    if (!targetPath) {
      throw new ProjectPathGuardError('目标路径（targetPath）不能为空。');
    }

    const resolvedRoot = path.resolve(projectRoot);
    const resolvedTarget = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(resolvedRoot, targetPath);

    // 计算相对路径
    const relative = path.relative(resolvedRoot, resolvedTarget);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new ProjectPathGuardError(
        `【安全拦截】检测到路径穿越攻击：目标路径 '${targetPath}'（解析为 '${resolvedTarget}'）试图跳出项目根目录 '${resolvedRoot}'。`
      );
    }

    // 检查软链接真实的 realpath 是否越界
    try {
      if (fs.existsSync(resolvedRoot)) {
        const realRoot = fs.realpathSync.native ? fs.realpathSync.native(resolvedRoot) : fs.realpathSync(resolvedRoot);

        // 查找 resolvedTarget 存在的祖先目录检查软链接
        let checkPath = resolvedTarget;
        while (!fs.existsSync(checkPath) && path.dirname(checkPath) !== checkPath) {
          checkPath = path.dirname(checkPath);
        }

        if (fs.existsSync(checkPath)) {
          const realCheck = fs.realpathSync.native ? fs.realpathSync.native(checkPath) : fs.realpathSync(checkPath);
          const realRel = path.relative(realRoot, realCheck);
          if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
            throw new ProjectPathGuardError(
              `【安全拦截】检测到软链接路径逃逸：目标路径 '${targetPath}' 实际指向了项目根目录外部路径 '${realCheck}'（项目根目录：'${realRoot}'）。`
            );
          }
        }
      }
    } catch (err) {
      if (err instanceof ProjectPathGuardError) {
        throw err;
      }
    }

    return resolvedTarget;
  }

  /**
   * 检查目标路径是否安全位于项目目录内
   */
  static isSafePath(projectRoot: string, targetPath: string): boolean {
    try {
      this.validatePath(projectRoot, targetPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 断言路径位于项目目录内
   */
  static assertInsideRoot(projectRoot: string, targetPath: string): string {
    return this.validatePath(projectRoot, targetPath);
  }
}
