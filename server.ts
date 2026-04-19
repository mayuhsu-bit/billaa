import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { execFile } from "child_process";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { promises as fs } from "fs";
import { google } from "googleapis";
import os from "os";
import path from "path";
import { promisify } from "util";
import { createServer as createViteServer } from "vite";
import { analyzeEmailContent, provideFinancialAdvice } from "./src/lib/gemini";

const app = express();
const PORT = 3000;
const execFileAsync = promisify(execFile);
const PDF_PASSWORD = process.env.STATEMENT_PDF_PASSWORD || "";
const ANALYZE_BATCH_SIZE = 1;
const MAX_ANALYZE_EMAILS = 8;
const ANALYZE_REQUEST_INTERVAL_MS = 5000;

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());
app.use(cors());

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

function getAppUrl() {
  const rawAppUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  return rawAppUrl.endsWith("/") ? rawAppUrl.slice(0, -1) : rawAppUrl;
}

function decodeBase64Url(data?: string | null) {
  if (!data) {
    return "";
  }

  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

function extractBody(payload: any): string {
  if (!payload) {
    return "";
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (!payload.parts) {
    return "";
  }

  for (const part of payload.parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
  }

  for (const part of payload.parts) {
    if (part.mimeType === "text/html" && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }

    if (part.parts?.length) {
      const nestedBody = extractBody(part);
      if (nestedBody) {
        return nestedBody;
      }
    }
  }

  return "";
}

function collectPdfParts(payload: any): Array<{ filename: string; attachmentId: string }> {
  if (!payload) {
    return [];
  }

  const results: Array<{ filename: string; attachmentId: string }> = [];

  const visit = (part: any) => {
    if (!part) {
      return;
    }

    const filename = part.filename || "";
    const attachmentId = part.body?.attachmentId;
    if (filename.toLowerCase().endsWith(".pdf") && attachmentId) {
      results.push({ filename, attachmentId });
    }

    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        visit(child);
      }
    }
  };

  visit(payload);
  return results;
}

function getBundledPythonPath() {
  return path.join(
    os.homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    "python.exe",
  );
}

async function extractPdfTextFromBuffer(buffer: Buffer, password: string) {
  const tempDir = path.join(process.cwd(), ".tmp");
  await fs.mkdir(tempDir, { recursive: true });

  const tempPath = path.join(
    tempDir,
    `statement-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
  );
  const scriptPath = path.join(process.cwd(), "scripts", "extract_pdf_text.py");

  await fs.writeFile(tempPath, buffer);
  try {
    const pythonPath = getBundledPythonPath();
    const args = password ? [scriptPath, tempPath, password] : [scriptPath, tempPath];
    const { stdout, stderr } = await execFileAsync(pythonPath, args, { cwd: process.cwd() });

    if (stderr) {
      console.error("PDF parser stderr:", stderr);
    }

    const result = JSON.parse(stdout || "{}");
    if (!result.ok) {
      console.error("PDF extraction error:", result.error);
      return "";
    }

    return typeof result.text === "string" ? result.text : "";
  } catch (error) {
    console.error("Failed to extract PDF text:", error);
    return "";
  } finally {
    await fs.unlink(tempPath).catch(() => undefined);
  }
}

function buildSearchQueries() {
  return [
    'in:anywhere "對帳單"',
    'in:anywhere "電子綜合對帳單"',
    'in:anywhere "銀行對帳單"',
    'in:anywhere "證券月對帳單"',
    'in:anywhere "複委託月對帳單"',
    'in:anywhere "對帳單" has:attachment',
    'in:anywhere "對帳單" filename:pdf',
    'in:anywhere "帳單" has:attachment',
    'in:anywhere "信用卡帳單"',
    'in:anywhere "月結單"',
    'in:anywhere "statement" has:attachment',
    'in:anywhere "bank statement"',
  ];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/auth/url", (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({
      error: "Missing Google OAuth credentials. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    });
  }

  const clientRedirectUri = req.query.redirect_uri as string | undefined;
  const redirectUri = clientRedirectUri || `${getAppUrl()}/auth/callback`;

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    redirectUri,
  );

  const state = Buffer.from(JSON.stringify({ redirectUri })).toString("base64");

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    prompt: "consent",
    state,
  });

  res.json({ url, redirectUri });
});

app.get("/auth/callback", async (req, res) => {
  const { code, error, state } = req.query;

  if (error) {
    return res.status(400).send(`Authentication error: ${error}`);
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(500).send("Missing Google OAuth credentials.");
  }

  try {
    let redirectUri = `${getAppUrl()}/auth/callback`;

    if (state) {
      try {
        const decodedState = JSON.parse(Buffer.from(state as string, "base64").toString("utf8"));
        if (decodedState.redirectUri) {
          redirectUri = decodedState.redirectUri;
        }
      } catch (decodeError) {
        console.error("Error decoding OAuth state:", decodeError);
      }
    }

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      redirectUri,
    );

    const { tokens } = await oauth2Client.getToken(code as string);
    const tokenJson = JSON.stringify(tokens);

    res.send(`
      <!DOCTYPE html>
      <html lang="zh-Hant">
        <head>
          <meta charset="UTF-8" />
          <title>Gmail 授權完成</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; }
            .card { background: white; padding: 32px; border-radius: 16px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12); max-width: 420px; width: calc(100% - 32px); text-align: center; }
            h1 { font-size: 24px; margin: 0 0 12px; color: #059669; }
            p { line-height: 1.6; color: #475569; }
            button { margin-top: 20px; padding: 12px 20px; width: 100%; border: none; border-radius: 10px; background: #0f172a; color: white; font-size: 15px; cursor: pointer; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>授權成功</h1>
            <p>你可以回到原本的視窗，系統會自動同步 Gmail 權杖。如果沒有自動關閉，再手動關閉這個視窗即可。</p>
            <button onclick="window.close()">關閉視窗</button>
          </div>
          <script>
            try {
              const tokens = ${tokenJson};
              const tokenData = JSON.stringify(tokens);
              if (window.opener) {
                window.opener.postMessage({ type: "OAUTH_AUTH_SUCCESS", tokens }, "*");
              }
              localStorage.setItem("gmail_tokens_sync", tokenData);
              setTimeout(() => window.close(), 1200);
            } catch (callbackError) {
              console.error("OAuth callback script error:", callbackError);
            }
          </script>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error("Error exchanging code for tokens:", err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html lang="zh-Hant">
        <head>
          <meta charset="UTF-8" />
          <title>Gmail 授權失敗</title>
        </head>
        <body style="font-family: sans-serif; padding: 2rem; background: #fef2f2; text-align: center;">
          <h2 style="color: #dc2626;">授權失敗</h2>
          <p>${err.message || "無法完成 OAuth 驗證流程。"}</p>
          <p>請檢查 Google Cloud Console 中的 Redirect URI、Client ID 與 Client Secret 是否正確。</p>
          <button onclick="window.close()" style="padding: 10px 20px; background: #dc2626; color: white; border: none; border-radius: 5px; cursor: pointer;">關閉視窗</button>
        </body>
      </html>
    `);
  }
});

app.post("/api/analyze", async (req, res) => {
  const { emails } = req.body;
  if (!emails || !Array.isArray(emails)) {
    return res.status(400).json({ error: "Invalid emails data." });
  }

  try {
    const results = [];
    const debug: Array<{ subject: string; usedTextLength: number; error?: string }> = [];

    const emailsToAnalyze = emails.slice(0, MAX_ANALYZE_EMAILS);

    for (let index = 0; index < emailsToAnalyze.length; index += ANALYZE_BATCH_SIZE) {
      const batch = emailsToAnalyze.slice(index, index + ANALYZE_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (email) => {
          const analysisText = [email.subject, email.snippet, email.body].filter(Boolean).join("\n\n");
          const attempt = await analyzeEmailContent(analysisText, email.subject || "Statement email");

          return {
            subject: email.subject || "(no subject)",
            usedTextLength: analysisText.length,
            error: attempt.error,
            analysis: attempt.analysis,
          };
        }),
      );

      for (const item of batchResults) {
        debug.push({
          subject: item.subject,
          usedTextLength: item.usedTextLength,
          error: item.error,
        });

        if (item.analysis) {
          results.push(item.analysis);
        }
      }

      if (index + ANALYZE_BATCH_SIZE < emailsToAnalyze.length) {
        await sleep(ANALYZE_REQUEST_INTERVAL_MS);
      }
    }

    const advice = results.length > 0 ? await provideFinancialAdvice(results) : "";
    res.json({
      results,
      advice,
      debug,
      meta: {
        totalEmailsReceived: emails.length,
        totalEmailsAnalyzed: emailsToAnalyze.length,
        batchSize: ANALYZE_BATCH_SIZE,
      },
    });
  } catch (analysisError: any) {
    console.error("Analysis error:", analysisError);
    res.status(500).json({ error: analysisError.message || "Analysis failed." });
  }
});

app.get("/api/gmail/messages", async (req, res) => {
  let tokensStr = req.cookies.gmail_tokens;
  const authHeader = req.headers.authorization;

  if (!tokensStr && authHeader?.startsWith("Bearer ")) {
    tokensStr = authHeader.substring(7);
  }

  if (!tokensStr) {
    return res.status(401).json({ error: "Not authenticated." });
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: "Missing Google OAuth credentials." });
  }

  try {
    const tokens = typeof tokensStr === "string" ? JSON.parse(tokensStr) : tokensStr;

    const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const messageMap = new Map<string, { id?: string | null; threadId?: string | null }>();

    for (const query of buildSearchQueries()) {
      const response = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: 20,
      });

      for (const message of response.data.messages || []) {
        if (message.id) {
          messageMap.set(message.id, message);
        }
      }
    }

    const messages = Array.from(messageMap.values()).slice(0, 40);
    if (messages.length === 0) {
      return res.json([]);
    }

    const detailedMessages = await Promise.all(
      messages.map(async (msg) => {
        try {
          const detail = await gmail.users.messages.get({
            userId: "me",
            id: msg.id!,
            format: "full",
          });

          const pdfParts = collectPdfParts(detail.data.payload);
          let body = extractBody(detail.data.payload).substring(0, 8000);

          if (!body && pdfParts.length > 0) {
            for (const pdfPart of pdfParts) {
              const attachment = await gmail.users.messages.attachments.get({
                userId: "me",
                messageId: msg.id!,
                id: pdfPart.attachmentId,
              });

              const attachmentData = attachment.data.data;
              if (!attachmentData) {
                continue;
              }

              const pdfBuffer = Buffer.from(
                attachmentData.replace(/-/g, "+").replace(/_/g, "/"),
                "base64",
              );

              const extractedText = await extractPdfTextFromBuffer(pdfBuffer, PDF_PASSWORD);
              if (extractedText) {
                body = `PDF Attachment: ${pdfPart.filename}\n${extractedText}`.substring(0, 8000);
                break;
              }
            }
          }

          return {
            id: msg.id,
            snippet: detail.data.snippet || "",
            date: detail.data.internalDate,
            subject:
              detail.data.payload?.headers?.find((header) => header.name === "Subject")?.value || "",
            body,
          };
        } catch (messageError) {
          console.error("Error reading Gmail message:", messageError);
          return null;
        }
      }),
    );

    res.json(detailedMessages.filter(Boolean));
  } catch (gmailError: any) {
    console.error("Error fetching Gmail messages:", gmailError);
    const statusCode =
      typeof gmailError.code === "number" && gmailError.code >= 100 && gmailError.code < 600
        ? gmailError.code
        : 500;
    res.status(statusCode).json({ error: gmailError.message || "Failed to fetch Gmail messages." });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("gmail_tokens");
  res.json({ success: true });
});

app.use(
  "/api",
  (err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("API Error:", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
      path: req.path,
    });
  },
);

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
