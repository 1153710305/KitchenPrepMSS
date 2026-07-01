/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import COS from "cos-nodejs-sdk-v5";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { AI_PROMPTS } from "./src/prompts.ts";

// 加载环境变量
dotenv.config();

/**
 * @description 后端持久化数据同步引擎，支持本地 JSON 文件与腾讯云 COS 对象存储双模式切换
 */
class StorageService {
  /**
   * @description 存储类型：local（本地文件） 或 cos（腾讯云对象存储）
   */
  private static storageType: string = process.env.STORAGE_TYPE || "local";

  /**
   * @description 本地文件存储路径，默认为项目根目录下 data/db.json
   */
  private static localDbPath: string = path.resolve(process.env.LOCAL_DB_PATH || "data/db.json");

  /**
   * @description 本地历史备份存储目录
   */
  private static backupDir: string = path.resolve(path.dirname(StorageService.localDbPath), "backups");

  /**
   * @description 腾讯云 COS 客户端实例
   */
  private static cosClient: COS | null = null;

  /**
   * @description 获取腾讯云 COS 客户端实例（延迟初始化）
   * @returns {COS} COS 客户端实例
   */
  private static getCosClient(): COS {
    if (!StorageService.cosClient) {
      StorageService.cosClient = new COS({
        SecretId: process.env.COS_SECRET_ID || "",
        SecretKey: process.env.COS_SECRET_KEY || "",
      });
    }
    return StorageService.cosClient;
  }

  /**
   * @description 获取 COS 配置参数
   * @returns {Object} 包含 Bucket, Region, Key 等配置
   */
  private static getCosConfig() {
    return {
      Bucket: process.env.COS_BUCKET || "",
      Region: process.env.COS_REGION || "",
      Key: process.env.COS_KEY || "kitchen_db.json"
    };
  }

  /**
   * @description 初始化存储引擎，创建必要的本地目录
   * @returns {void}
   */
  public static init(): void {
    if (StorageService.storageType === "local") {
      const dir = path.dirname(StorageService.localDbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[STORAGE] 已成功创建本地数据存储目录: ${dir}`);
      }
      if (!fs.existsSync(StorageService.backupDir)) {
        fs.mkdirSync(StorageService.backupDir, { recursive: true });
        console.log(`[STORAGE] 已成功创建本地备份快照目录: ${StorageService.backupDir}`);
      }
    } else {
      console.log("[STORAGE] 启动云端存储模式：已挂载腾讯云 COS 同步总线。");
    }
  }

  /**
   * @description 加载主数据库内容
   * @returns {Promise<any>} 返回 JSON 数据对象
   */
  public static async load(): Promise<any> {
    if (StorageService.storageType === "cos") {
      const { Bucket, Region, Key } = StorageService.getCosConfig();
      return new Promise((resolve) => {
        StorageService.getCosClient().getObject({
          Bucket,
          Region,
          Key
        }, (err, data) => {
          if (err) {
            // 如果文件不存在 (404 / NoSuchKey)，则返回空对象，供前端自行初始化默认值
            if (err.statusCode === 404 || err.code === "NoSuchKey") {
              console.log("[STORAGE COS] COS上暂无数据文件，将返回空初始集。");
              resolve({});
            } else {
              console.error("[STORAGE COS] 从腾讯云拉取数据失败:", err);
              resolve({});
            }
          } else {
            try {
              const bodyStr = data.Body.toString("utf8");
              resolve(JSON.parse(bodyStr));
            } catch (parseErr) {
              console.error("[STORAGE COS] 解析云端JSON失败:", parseErr);
              resolve({});
            }
          }
        });
      });
    } else {
      // 本地存储模式
      if (!fs.existsSync(StorageService.localDbPath)) {
        return {};
      }
      try {
        const content = fs.readFileSync(StorageService.localDbPath, "utf8");
        return JSON.parse(content);
      } catch (err) {
        console.error("[STORAGE LOCAL] 读取本地数据失败:", err);
        return {};
      }
    }
  }

  /**
   * @description 保存数据到引擎，并自动生成备份快照
   * @param {any} data 需要保存的全量数据包
   * @returns {Promise<boolean>} 保存成功返回 true，失败返回 false
   */
  public static async save(data: any): Promise<boolean> {
    const dataStr = JSON.stringify(data, null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    if (StorageService.storageType === "cos") {
      const { Bucket, Region, Key } = StorageService.getCosConfig();
      // 1. 保存主数据
      const saveMain = new Promise<boolean>((resolve) => {
        StorageService.getCosClient().putObject({
          Bucket,
          Region,
          Key,
          Body: Buffer.from(dataStr, "utf8")
        }, (err) => {
          if (err) {
            console.error("[STORAGE COS] 保存主数据至云端失败:", err);
            resolve(false);
          } else {
            console.log("[STORAGE COS] 主数据已成功落盘至腾讯云 COS");
            resolve(true);
          }
        });
      });

      // 2. 保存快照备份，以便发生意外时恢复 (异步上传，不阻塞主线程)
      const backupKey = `backups/db_${timestamp}.json`;
      StorageService.getCosClient().putObject({
        Bucket,
        Region,
        Key: backupKey,
        Body: Buffer.from(dataStr, "utf8")
      }, (err) => {
        if (err) {
          console.error(`[STORAGE COS] 备份快照 ${backupKey} 上传失败:`, err);
        } else {
          console.log(`[STORAGE COS] 成功生成云端备份快照: ${backupKey}`);
        }
      });

      return saveMain;
    } else {
      // 本地存储模式
      try {
        // 1. 保存当前主数据
        fs.writeFileSync(StorageService.localDbPath, dataStr, "utf8");
        console.log(`[STORAGE LOCAL] 数据已写入本地文件: ${StorageService.localDbPath}`);

        // 2. 写入时间戳快照文件
        const snapshotPath = path.join(StorageService.backupDir, `db_${timestamp}.json`);
        fs.writeFileSync(snapshotPath, dataStr, "utf8");
        console.log(`[STORAGE LOCAL] 成功生成本地物理备份快照: ${snapshotPath}`);

        // 3. 限制本地历史备份文件总数（最多保留30个版本）
        StorageService.trimLocalBackups();
        return true;
      } catch (err) {
        console.error("[STORAGE LOCAL] 写入本地数据失败:", err);
        return false;
      }
    }
  }

  /**
   * @description 获取备份列表
   * @returns {Promise<string[]>} 快照名称列表
   */
  public static async getBackups(): Promise<string[]> {
    if (StorageService.storageType === "cos") {
      const { Bucket, Region } = StorageService.getCosConfig();
      return new Promise((resolve) => {
        StorageService.getCosClient().getBucket({
          Bucket,
          Region,
          Prefix: "backups/"
        }, (err, data) => {
          if (err) {
            console.error("[STORAGE COS] 列出云端快照失败:", err);
            resolve([]);
          } else {
            const files = (data.Contents || [])
              .map((item) => item.Key)
              .filter((key) => key && key.endsWith(".json"))
              .sort()
              .reverse(); // 从新到旧
            resolve(files);
          }
        });
      });
    } else {
      // 本地存储模式
      try {
        if (!fs.existsSync(StorageService.backupDir)) {
          return [];
        }
        const files = fs.readdirSync(StorageService.backupDir)
          .filter((file) => file.startsWith("db_") && file.endsWith(".json"))
          .sort()
          .reverse(); // 从新到旧
        return files;
      } catch (err) {
        console.error("[STORAGE LOCAL] 读取本地快照列表失败:", err);
        return [];
      }
    }
  }

  /**
   * @description 从指定备份文件恢复数据
   * @param {string} backupName 快照名称
   * @returns {Promise<any>} 恢复后的 JSON 数据对象
   */
  public static async restore(backupName: string): Promise<any> {
    if (StorageService.storageType === "cos") {
      const { Bucket, Region } = StorageService.getCosConfig();
      return new Promise((resolve) => {
        StorageService.getCosClient().getObject({
          Bucket,
          Region,
          Key: backupName
        }, (err, data) => {
          if (err) {
            console.error(`[STORAGE COS] 从云端快照 ${backupName} 读取数据失败:`, err);
            resolve(null);
          } else {
            try {
              const bodyStr = data.Body.toString("utf8");
              resolve(JSON.parse(bodyStr));
            } catch (parseErr) {
              console.error("[STORAGE COS] 解析备份JSON失败:", parseErr);
              resolve(null);
            }
          }
        });
      });
    } else {
      // 本地存储模式
      const targetPath = path.join(StorageService.backupDir, backupName);
      if (!fs.existsSync(targetPath)) {
        return null;
      }
      try {
        const content = fs.readFileSync(targetPath, "utf8");
        const parsed = JSON.parse(content);
        // 将恢复的数据写回主库文件
        fs.writeFileSync(StorageService.localDbPath, content, "utf8");
        console.log(`[STORAGE LOCAL] 成功从本地快照 ${backupName} 覆盖恢复主数据库`);
        return parsed;
      } catch (err) {
        console.error("[STORAGE LOCAL] 本地快照恢复失败:", err);
        return null;
      }
    }
  }

  /**
   * @description 裁剪本地历史备份文件数，防止过度占用硬盘空间
   * @returns {void}
   */
  private static trimLocalBackups(): void {
    try {
      const files = fs.readdirSync(StorageService.backupDir)
        .filter((file) => file.startsWith("db_") && file.endsWith(".json"))
        .sort(); // 升序排列（旧文件在前面）

      const maxBackups = 30;
      if (files.length > maxBackups) {
        const filesToDelete = files.slice(0, files.length - maxBackups);
        filesToDelete.forEach((file) => {
          const deletePath = path.join(StorageService.backupDir, file);
          fs.unlinkSync(deletePath);
          console.log(`[STORAGE LOCAL] 已自动清理历史超期本地备份: ${file}`);
        });
      }
    } catch (err) {
      console.error("[STORAGE LOCAL] 清理超期备份失败:", err);
    }
  }
}

// 初始化存储目录
StorageService.init();

/**
 * @description 日志文件持久化服务类，在本地部署时把日志保存在本地，包含详细时间、事件描述
 */
class LogService {
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

/**
 * @description 初始化 Express 实例
 */
const app = express();

/**
 * @description 后门默认常规绑定端口
 */
const PORT = 3000;

// 配置 JSON 解析器
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// 记录请求日志中转器
app.use((req, res, next) => {
  console.log(`[HTTP LOG] [${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/**
 * @description 二步拦截：防空哨兵，保证没有配置 Key 时仍能优雅返回前端排查
 */
const getGeminiClient = (): GoogleGenAI | null => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    console.warn("[WARNING] GEMINI_API_KEY 缺失或者是占位符，AI功能将会返回降级错误信息。");
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

/**
 * @description 统一分析接口，支持流式 (SSE) 与常规 JSON 输出切换
 * @route POST /api/gemini/analyze
 */
app.post("/api/gemini/analyze", async (req, res): Promise<any> => {
  try {
    const { targetGroupLabel, year, month, itemsJson, summarizedSummary, stream = false } = req.body;
    
    // 自检空参数
    if (!targetGroupLabel || !itemsJson) {
      return res.status(400).json({ error: "参数不完整，要求提供受众分组与统计细则JSON" });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: "集成未配置：检测到服务端未挂载有效的 GEMINI_API_KEY 环境变量。\n请在 AI Studio 右上角 Settings > Secrets 选项卡中增加您的密钥，或使用无密钥模式本地演算。"
      });
    }

    // 编译 Markdown 结构化提示词
    const completePrompt = AI_PROMPTS.analysisPromptTemplate
      .replace("{targetGroupLabel}", String(targetGroupLabel))
      .replace("{year}", String(year))
      .replace("{month}", String(month))
      .replace("{summarizedSummary}", String(summarizedSummary))
      .replace("{itemsJson}", String(itemsJson));

    console.log(`[AI ANALYZE] 接收到诊断请求，目标: ${targetGroupLabel}, 模式: ${stream ? "流式(SSE)" : "常规JSON"}`);

    if (stream) {
      // 开启服务器发送事件 (SSE) 协议响应头
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders(); // 首包冲刷

      try {
        const streamResponse = await ai.models.generateContentStream({
          model: "gemini-3.5-flash",
          contents: completePrompt,
          config: {
            systemInstruction: AI_PROMPTS.systemInstruction,
            temperature: 0.8
          }
        });

        for await (const chunk of streamResponse) {
          if (chunk.text) {
            // 写入 SSE 标准帧
            res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
          }
        }
        
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (streamErr: any) {
        console.error("[STREAM ERROR] SSE 流渲染解析到一半中途崩塌:", streamErr);
        res.write(`data: ${JSON.stringify({ error: "AI生成流遇到阻碍: " + streamErr.message })}\n\n`);
        res.end();
      }
    } else {
      // 常规单次完整传输（常规API模式）
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: completePrompt,
        config: {
          systemInstruction: AI_PROMPTS.systemInstruction,
          temperature: 0.8
        }
      });

      res.json({ text: response.text });
    }
  } catch (globalErr: any) {
    console.error("[SERVER GLOBAL ERROR] 接口异常崩裂:", globalErr);
    res.status(500).json({ error: "服务器内部发生了极严重的运行崩解: " + globalErr.message });
  }
});

/**
 * @description 获取云端或本地存储的完整数据
 * @route GET /api/storage/load
 */
app.get("/api/storage/load", async (req, res) => {
  try {
    const data = await StorageService.load();
    res.json(data);
  } catch (err: any) {
    console.error("[API LOAD ERROR] 读取数据失败:", err);
    res.status(500).json({ error: "读取存储数据失败: " + err.message });
  }
});

/**
 * @description 保存全量数据到云端或本地存储并生成快照
 * @route POST /api/storage/save
 */
app.post("/api/storage/save", async (req, res) => {
  try {
    const success = await StorageService.save(req.body);
    if (success) {
      res.json({ success: true, timestamp: new Date().toISOString() });
    } else {
      res.status(500).json({ error: "保存数据失败" });
    }
  } catch (err: any) {
    console.error("[API SAVE ERROR] 保存数据失败:", err);
    res.status(500).json({ error: "写入存储数据失败: " + err.message });
  }
});

/**
 * @description 获取历史备份快照列表
 * @route GET /api/storage/backups
 */
app.get("/api/storage/backups", async (req, res) => {
  try {
    const backups = await StorageService.getBackups();
    res.json(backups);
  } catch (err: any) {
    console.error("[API BACKUPS ERROR] 获取备份列表失败:", err);
    res.status(500).json({ error: "获取备份快照列表失败: " + err.message });
  }
});

/**
 * @description 从历史备份快照恢复数据
 * @route POST /api/storage/restore
 */
app.post("/api/storage/restore", async (req, res) => {
  try {
    const { backupName } = req.body;
    if (!backupName) {
      return res.status(400).json({ error: "参数不完整，缺少快照名称 backupName" });
    }
    const data = await StorageService.restore(backupName);
    if (data) {
      res.json({ success: true, data });
    } else {
      res.status(500).json({ error: "从快照恢复数据失败，文件可能不存在或已损坏" });
    }
  } catch (err: any) {
    console.error("[API RESTORE ERROR] 恢复快照数据失败:", err);
    res.status(500).json({ error: "恢复备份数据失败: " + err.message });
  }
});

/**
 * @description 接收系统日志上报接口，保存到本地日志文件
 * @route POST /api/log
 */
app.post("/api/log", (req, res) => {
  const { level = "INFO", category = "System", message = "" } = req.body;
  LogService.write(level, category, message);
  res.json({ success: true });
});

/**
 * @description 历史测试心跳
 */
app.get("/api/health", (req, res) => {
  res.json({ status: "alive", timestamp: new Date().toISOString() });
});

/**
 * @description 挂载 Vite 开发中间件以保高画质更新
 */
async function bootstrap() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("[SYSTEM BOOT] 已成功以 VITE 实时 HMR 仿真宿主模式挂载 Express 客户端页面件");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("[SYSTEM BOOT] 生产模式启动：托管静态主包路径在 dist/");
  }

  // 绑定宿主 0.0.0.0 以绕过沙箱
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[KITCHEN SYSTEM LIVE] 服务就绪! 请访问外部绑定端口层: http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("[FATAL ERROR] 启动服务器引擎阶段直接死亡:", err);
});
