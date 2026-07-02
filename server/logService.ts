/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @description 服务端日志文件持久化服务：将系统运行时的信息/警告/错误日志以带时间戳的格式追加写入本地日志文件，供开发与运维排查问题。
 */

import path from "path";
import fs from "fs";

/**
 * @description 日志文件持久化服务类，在本地部署时把日志保存在本地，包含详细时间、事件描述
 */
export class LogService {
  /** 本地日志存储物理路径，默认为 data/app.log */
  private static logFilePath: string = path.resolve(process.env.LOCAL_LOG_PATH || "data/app.log");

  /**
   * 初始化日志所在目录
   */
  public static init(): void {
    const dir = path.dirname(LogService.logFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 写入一条带标准格式时间戳的日志行到本地物理日志文件
   */
  public static write(level: string, category: string, message: string): void {
    try {
      const timeStr = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
      const logLine = `[${timeStr}] [${level}] [${category}] ${message}\n`;
      fs.appendFileSync(LogService.logFilePath, logLine, "utf8");
    } catch (err) {
      console.error("[LOG SERVICE ERROR] 写入本地日志文件失败:", err);
    }
  }
}

// 初始化日志系统物理目录
LogService.init();
