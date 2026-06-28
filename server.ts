/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { AI_PROMPTS } from "./src/prompts.ts";

// 加载环境变量
dotenv.config();

/**
 * @description 初始化 Express 实例
 */
const app = express();

/**
 * @description 后门默认常规绑定端口
 */
const PORT = 3000;

// 配置 JSON 解析器
app.use(express.json());

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
