/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 服务端日志文件持久化服务：将系统运行时的信息/警告/错误日志以带时间戳的格式追加写入本地日志文件；日志按"日期"自动分文件归档，单个日期文件超出体积上限时自动按序号滚动到下一个分片文件，避免出现体积无限增长的单个大文件。
 */

import path from "path";
import fs from "fs";

/**
 * @description 日志文件持久化服务类，在本地部署时把日志保存在本地，按日期+体积自动归档，包含详细时间、事件描述
 */
export class LogService {
  /** 本地日志根目录，默认为 data/logs，每天的日志各自独立成文件存放于此目录下 */
  private static logDir: string = path.resolve(process.env.LOCAL_LOG_DIR || "data/logs");

  /** 单个日志文件的体积上限（字节），默认 5MB；超出后自动滚动到下一个序号分片文件继续写入 */
  private static maxFileSizeBytes: number =
    (Number(process.env.LOG_MAX_FILE_SIZE_MB) || 5) * 1024 * 1024;

  /** 当前缓存的活跃日志文件路径，避免每次写入都重新扫描目录 */
  private static activeFilePath: string | null = null;

  /**
   * 初始化日志所在目录，并将升级前遗留的单一大日志文件（data/app.log）平滑迁移进新的归档目录，避免旧日志被遗漏
   */
  public static init(): void {
    if (!fs.existsSync(LogService.logDir)) {
      fs.mkdirSync(LogService.logDir, { recursive: true });
    }

    const legacyLogPath = path.resolve("data/app.log");
    const migratedLegacyPath = path.join(LogService.logDir, "app-legacy-migrated.log");
    if (fs.existsSync(legacyLogPath) && !fs.existsSync(migratedLegacyPath)) {
      try {
        fs.renameSync(legacyLogPath, migratedLegacyPath);
        console.log(`[LOG SERVICE] 已将升级前的历史日志文件迁移至归档目录: ${migratedLegacyPath}`);
      } catch (err) {
        console.error("[LOG SERVICE ERROR] 迁移历史日志文件失败:", err);
      }
    }
  }

  /**
   * @description 获取当前日期（Asia/Shanghai 时区）对应的日志文件基础名，如 app-2026-07-03
   */
  private static getTodayBaseName(): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }); // sv-SE 语言环境固定输出 YYYY-MM-DD 格式
    return `app-${dateStr}`;
  }

  /**
   * @description 解析当前应写入的日志文件路径：按日期归档，若当天已有文件写满（超出体积上限）则自动滚动到下一个序号分片
   * @returns {string} 当前应写入的日志文件绝对路径
   */
  private static resolveActiveLogFilePath(): string {
    const baseName = LogService.getTodayBaseName();

    // 优先复用缓存路径（同一天且尚未写满时，避免重复扫描目录）
    if (LogService.activeFilePath && path.basename(LogService.activeFilePath).startsWith(baseName)) {
      try {
        const stat = fs.statSync(LogService.activeFilePath);
        if (stat.size < LogService.maxFileSizeBytes) {
          return LogService.activeFilePath;
        }
      } catch {
        // 缓存路径的文件不存在（如被手动删除），忽略并重新计算
      }
    }

    // 从当天的主文件开始，逐个序号探测，找到第一个"不存在"或"未写满"的分片文件
    let candidate = path.join(LogService.logDir, `${baseName}.log`);
    let seq = 0;
    while (fs.existsSync(candidate)) {
      const stat = fs.statSync(candidate);
      if (stat.size < LogService.maxFileSizeBytes) {
        break;
      }
      seq += 1;
      candidate = path.join(LogService.logDir, `${baseName}.${seq}.log`);
    }

    LogService.activeFilePath = candidate;
    return candidate;
  }

  /**
   * 写入一条带标准格式时间戳的日志行到本地物理日志文件（自动按日期+体积归档）
   */
  public static write(level: string, category: string, message: string): void {
    const writeLog = () => {
      const filePath = LogService.resolveActiveLogFilePath();
      const timeStr = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
      const logLine = `[${timeStr}] [${level}] [${category}] ${message}\n`;
      fs.appendFileSync(filePath, logLine, "utf8");
    };

    try {
      writeLog();
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        try {
          // 如果目录被人为删除了，尝试重新创建目录并重试一次
          fs.mkdirSync(LogService.logDir, { recursive: true });
          writeLog();
        } catch (retryErr) {
          console.error("[LOG SERVICE ERROR] 重建日志目录并重试写入失败:", retryErr);
        }
      } else {
        console.error("[LOG SERVICE ERROR] 写入本地日志文件失败:", err);
      }
    }
  }
}

// 初始化日志系统物理目录
LogService.init();
