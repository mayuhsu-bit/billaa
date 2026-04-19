import React from "react";
import { Mail, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Login() {
  const currentRedirectUri = `${window.location.origin}/auth/callback`;

  const handleLogin = async () => {
    try {
      const response = await fetch(
        `/api/auth/url?redirect_uri=${encodeURIComponent(currentRedirectUri)}`,
      );
      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "無法開始 Google 登入流程，請先確認後端環境變數已設定。");
        return;
      }

      const authWindow = window.open(data.url, "oauth_popup", "width=600,height=700");
      if (!authWindow) {
        alert("瀏覽器阻擋了登入視窗，請允許彈出視窗後再試一次。");
      }
    } catch (error) {
      console.error("OAuth error:", error);
      alert("登入流程發生錯誤，請稍後再試。");
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-6"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 text-indigo-600 text-sm font-medium">
            <Sparkles className="w-4 h-4" />
            AI 信用卡帳單分析助手
          </div>

          <h1 className="text-5xl font-extrabold tracking-tight text-slate-900 leading-tight">
            從 Gmail 抓出帳單，
            <br />
            <span className="text-indigo-600">自動整理你的刷卡消費</span>
          </h1>

          <p className="text-lg text-slate-600 leading-relaxed">
            連接 Gmail 之後，系統會搜尋常見的信用卡帳單郵件，並用 Gemini 協助整理交易資訊、
            統計分類和生成理財建議。
          </p>

          <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl space-y-2">
            <h3 className="text-amber-800 font-bold text-sm flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              OAuth 設定提醒
            </h3>
            <p className="text-xs text-amber-700">
              請把下面這個 Redirect URI 加到 Google Cloud Console 的 Authorized redirect
              URIs。
            </p>
            <code className="block p-2 bg-white rounded border border-amber-200 text-[10px] break-all text-slate-600 select-all">
              {currentRedirectUri}
            </code>
            <p className="text-[10px] text-amber-600">
              如果看到 403 或 redirect_uri_mismatch，通常就是這裡還沒設定完成。
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <Card className="border-none shadow-2xl bg-white p-4">
            <CardHeader className="text-center space-y-2">
              <div className="mx-auto w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200 mb-4">
                <Mail className="w-8 h-8 text-white" />
              </div>
              <CardTitle className="text-2xl font-bold">登入 Gmail 開始分析</CardTitle>
              <CardDescription>
                使用 Google OAuth 授權後，就能讀取你的帳單郵件並產生整理結果。
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <Button
                onClick={handleLogin}
                className="w-full h-12 text-lg bg-slate-900 hover:bg-slate-800 text-white transition-all"
              >
                使用 Google 登入
              </Button>

              <div className="pt-2 border-t border-slate-50">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-slate-400 hover:text-indigo-600 text-xs"
                  onClick={() => window.location.reload()}
                >
                  如果剛設定完憑證，可以重新整理後再試
                </Button>
              </div>

              <p className="text-xs text-center text-slate-400">
                目前只會申請 Gmail 唯讀權限，不會修改或寄出任何郵件。
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
