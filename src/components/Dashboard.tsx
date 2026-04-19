import React, { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  CreditCard,
  LogOut,
  PieChart as PieChartIcon,
  RefreshCw,
  Tag,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface Transaction {
  date: string;
  merchant: string;
  amount: number;
  category: string;
}

export interface StatementAnalysis {
  month: string;
  totalAmount: number;
  transactions: Transaction[];
  summary: string;
}

interface EmailDebug {
  subject: string;
  usedTextLength: number;
  error?: string;
}

interface EmailItem {
  id: string;
  snippet: string;
  date?: string;
  subject: string;
  body: string;
}

interface CachedMonthAnalysis {
  analyses: StatementAnalysis[];
  advice: string;
  debug: EmailDebug[];
  cachedAt: string;
}

const COLORS = ["#2563EB", "#10B981", "#F59E0B", "#F97316", "#8B5CF6", "#06B6D4"];
const CACHE_PREFIX = "gmail_bill_analysis_cache_v1";

function getMonthKey(email: EmailItem) {
  if (!email.date) {
    return "unknown";
  }

  const timestamp = Number(email.date);
  if (Number.isNaN(timestamp)) {
    return "unknown";
  }

  return new Date(timestamp).toISOString().slice(0, 7);
}

function formatMonthLabel(month: string) {
  if (month === "unknown") {
    return "無法判定月份";
  }

  const [year, value] = month.split("-");
  return `${year} 年 ${Number(value)} 月`;
}

function getCacheKey(month: string) {
  return `${CACHE_PREFIX}:${month}`;
}

function readMonthCache(month: string): CachedMonthAnalysis | null {
  try {
    const raw = localStorage.getItem(getCacheKey(month));
    return raw ? (JSON.parse(raw) as CachedMonthAnalysis) : null;
  } catch {
    return null;
  }
}

function writeMonthCache(month: string, value: CachedMonthAnalysis) {
  localStorage.setItem(getCacheKey(month), JSON.stringify(value));
}

const largeButton = "h-14 px-6 text-lg rounded-xl";

export default function Dashboard({
  onLogout,
  tokens,
}: {
  onLogout: () => void;
  tokens: string | null;
}) {
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<StatementAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [advice, setAdvice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [analysisDebug, setAnalysisDebug] = useState<EmailDebug[]>([]);
  const [cacheInfo, setCacheInfo] = useState<string | null>(null);

  const monthOptions = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const email of emails) {
      const month = getMonthKey(email);
      grouped.set(month, (grouped.get(month) || 0) + 1);
    }

    return Array.from(grouped.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [emails]);

  const selectedEmails = useMemo(() => {
    if (!selectedMonth) {
      return [];
    }
    return emails.filter((email) => getMonthKey(email) === selectedMonth);
  }, [emails, selectedMonth]);

  const clearCurrentResults = () => {
    setAnalyses([]);
    setAdvice("");
    setAnalysisDebug([]);
    setCacheInfo(null);
  };

  const fetchEmails = async () => {
    setLoading(true);
    setError(null);
    clearCurrentResults();

    try {
      const headers: Record<string, string> = {};
      if (tokens) {
        headers.Authorization = `Bearer ${tokens}`;
      }

      const emailRes = await fetch("/api/gmail/messages", { headers });
      const emailData = await emailRes.json();

      if (!emailRes.ok) {
        throw new Error(emailData.error || "無法讀取 Gmail 郵件。");
      }

      const fetchedEmails = (emailData || []) as EmailItem[];
      setEmails(fetchedEmails);

      const months = Array.from(new Set(fetchedEmails.map((email) => getMonthKey(email)))).sort((a, b) =>
        b.localeCompare(a),
      );
      setSelectedMonth(months[0] || null);
    } catch (err: any) {
      console.error("Dashboard error:", err);
      setError(err.message || "系統發生未預期錯誤。");
    } finally {
      setLoading(false);
    }
  };

  const loadCachedMonth = (month: string) => {
    const cached = readMonthCache(month);
    if (!cached) {
      clearCurrentResults();
      return false;
    }

    setAnalyses(cached.analyses || []);
    setAdvice(cached.advice || "");
    setAnalysisDebug(cached.debug || []);
    setCacheInfo(cached.cachedAt);
    return true;
  };

  const analyzeMonth = async (month: string | null, forceRefresh = false) => {
    if (!month) {
      setError("請先選擇要分析的月份。");
      return;
    }

    setSelectedMonth(month);

    if (!forceRefresh && loadCachedMonth(month)) {
      return;
    }

    const monthEmails = emails.filter((email) => getMonthKey(email) === month);
    if (!monthEmails.length) {
      setError("這個月份目前沒有可分析的郵件。");
      return;
    }

    setAnalyzing(true);
    setError(null);
    clearCurrentResults();

    try {
      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: monthEmails }),
      });
      const analyzeData = await analyzeRes.json();

      if (!analyzeRes.ok) {
        throw new Error(analyzeData.error || "帳單分析失敗。");
      }

      const nextAnalyses = analyzeData.results || [];
      const nextAdvice = analyzeData.advice || "";
      const nextDebug = analyzeData.debug || [];
      const cachedAt = new Date().toISOString();

      setAnalyses(nextAnalyses);
      setAdvice(nextAdvice);
      setAnalysisDebug(nextDebug);
      setCacheInfo(cachedAt);

      writeMonthCache(month, {
        analyses: nextAnalyses,
        advice: nextAdvice,
        debug: nextDebug,
        cachedAt,
      });
    } catch (err: any) {
      console.error("Analyze month error:", err);
      setError(err.message || "月份分析失敗。");
    } finally {
      setAnalyzing(false);
    }
  };

  const analyzeSelectedMonth = async (forceRefresh = false) => {
    await analyzeMonth(selectedMonth, forceRefresh);
  };

  useEffect(() => {
    if (tokens) {
      fetchEmails();
    }
  }, [tokens]);

  useEffect(() => {
    if (!selectedMonth) {
      clearCurrentResults();
      return;
    }

    if (!loadCachedMonth(selectedMonth)) {
      clearCurrentResults();
    }
  }, [selectedMonth]);

  const pieData = analyses
    .flatMap((analysis) => analysis.transactions)
    .reduce<Record<string, number>>((acc, transaction) => {
      acc[transaction.category] = (acc[transaction.category] || 0) + transaction.amount;
      return acc;
    }, {});

  const categoryData: Array<{ name: string; value: number }> = Object.entries(pieData).map(
    ([name, value]) => ({ name, value: Number(value) }),
  );
  const monthlyData = analyses
    .map((analysis) => ({ month: analysis.month, amount: analysis.totalAmount }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const totalAmount = analyses.reduce((sum, analysis) => sum + analysis.totalAmount, 0);
  const topCategory = [...categoryData].sort((a, b) => b.value - a.value)[0]?.name || "尚無資料";

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-24" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 space-y-6 bg-slate-50">
        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center">
          <AlertCircle className="w-12 h-12 text-red-500" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-slate-900">發生錯誤</h2>
          <p className="text-slate-500 max-w-md">{error}</p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <Button onClick={fetchEmails} className={largeButton}>
            <RefreshCw className="w-5 h-5 mr-2" />
            重新抓取郵件
          </Button>
          <Button onClick={onLogout} variant="outline" className={largeButton}>
            登出 Gmail
          </Button>
        </div>
      </div>
    );
  }

  if (!emails.length) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-4 space-y-6">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center">
          <CreditCard className="w-10 h-10 text-slate-400" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-slate-900">找不到可分析的帳單郵件</h2>
          <p className="text-slate-500 max-w-md">
            系統目前沒有查到符合條件的 Gmail 郵件。你可以重新整理，或之後再補指定寄件人條件讓我們收斂。
          </p>
        </div>
        <div className="flex gap-4">
          <Button onClick={fetchEmails} variant="outline" className={largeButton}>
            <RefreshCw className="w-5 h-5 mr-2" />
            重新整理
          </Button>
          <Button onClick={onLogout} variant="ghost" className={largeButton}>
            登出
          </Button>
        </div>
      </div>
    );
  }

  if (analyzing) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-4 space-y-6">
        <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center">
          <RefreshCw className="w-12 h-12 text-indigo-500 animate-spin" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold text-slate-900">
            正在分析 {selectedMonth ? formatMonthLabel(selectedMonth) : "所選月份"}
          </h2>
          <p className="text-slate-500 max-w-md text-lg">
            目前會逐封慢慢分析，避免撞到 Gemini 配額。這一步可能需要幾十秒。
          </p>
        </div>
      </div>
    );
  }

  if (!analyses.length && analysisDebug.length) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="text-center space-y-2 pt-8">
            <h1 className="text-3xl font-bold text-slate-900">這個月份有抓到郵件，但分析還沒成功</h1>
            <p className="text-slate-500">
              {selectedMonth ? formatMonthLabel(selectedMonth) : "目前月份"} 的郵件已經送進分析，下方是失敗原因。
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">分析 Debug</CardTitle>
              <CardDescription>下面是這個月份送進分析的郵件與失敗原因。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {analysisDebug.slice(0, 10).map((item, index) => (
                <div key={`${item.subject}-${index}`} className="rounded-lg border p-4 text-sm">
                  <div className="font-medium text-slate-800">{item.subject || "(無主旨)"}</div>
                  <div className="text-slate-500">送入分析文字長度：{item.usedTextLength}</div>
                  <div className="text-red-500 break-words">失敗原因：{item.error || "未知錯誤"}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => clearCurrentResults()} className={largeButton}>
              <Calendar className="w-5 h-5 mr-2" />
              回到月份選擇
            </Button>
            <Button onClick={() => analyzeSelectedMonth(true)} className={largeButton}>
              <RefreshCw className="w-5 h-5 mr-2" />
              重新分析本月
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!analyses.length) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] p-4 md:p-8">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="text-center space-y-2 pt-8">
            <h1 className="text-4xl font-bold text-slate-900">先選月份，再分析</h1>
            <p className="text-slate-500 text-lg">
              目前共抓到 {emails.length} 封疑似帳單郵件。先選定月份，只分析那個月份，速度會更穩。
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">可分析月份</CardTitle>
              <CardDescription>每個月份只會分析該月份的郵件，避免一次處理過多內容。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {monthOptions.map((option) => (
                  <button
                    key={option.month}
                    type="button"
                    onClick={() => analyzeMonth(option.month, false)}
                    className={`rounded-2xl border px-5 py-5 text-left transition min-h-28 ${
                      selectedMonth === option.month
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white hover:border-slate-400"
                    }`}
                  >
                    <div className="font-semibold text-xl">{formatMonthLabel(option.month)}</div>
                    <div className={`text-base mt-1 ${selectedMonth === option.month ? "text-slate-200" : "text-slate-500"}`}>
                      {option.count} 封郵件
                    </div>
                  </button>
                ))}
              </div>

              <div className="rounded-xl bg-slate-50 p-5 text-base text-slate-600">
                目前選擇：{selectedMonth ? formatMonthLabel(selectedMonth) : "尚未選擇"}，共{" "}
                {selectedEmails.length} 封待分析。
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={() => analyzeSelectedMonth(false)} disabled={!selectedMonth} className={largeButton}>
                  <CheckCircle2 className="w-5 h-5 mr-2" />
                  分析這個月份
                </Button>
                <Button onClick={fetchEmails} variant="outline" className={largeButton}>
                  <RefreshCw className="w-5 h-5 mr-2" />
                  重新抓取郵件
                </Button>
                <Button onClick={onLogout} variant="ghost" className={largeButton}>
                  登出
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">信用卡帳單分析</h1>
            <p className="text-slate-500">
              目前查看 {selectedMonth ? formatMonthLabel(selectedMonth) : "本次分析"} 的結果。
            </p>
            {cacheInfo ? (
              <p className="text-xs text-slate-400">使用快取結果，建立時間：{new Date(cacheInfo).toLocaleString()}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => clearCurrentResults()} className={largeButton}>
              <Calendar className="w-5 h-5 mr-2" />
              重新選月份
            </Button>
            <Button variant="outline" onClick={() => analyzeSelectedMonth(true)} className={largeButton}>
              <RefreshCw className="w-5 h-5 mr-2" />
              重新分析本月
            </Button>
            <Button variant="ghost" onClick={onLogout} className={`${largeButton} text-slate-500 hover:text-red-500`}>
              <LogOut className="w-5 h-5 mr-2" />
              登出
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-none shadow-sm bg-white">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Wallet className="w-4 h-4" />
                總支出
              </CardDescription>
              <CardTitle className="text-3xl font-bold text-slate-900">
                ${totalAmount.toLocaleString()}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card className="border-none shadow-sm bg-white">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                帳單月份數
              </CardDescription>
              <CardTitle className="text-3xl font-bold text-slate-900">{analyses.length} 份</CardTitle>
            </CardHeader>
          </Card>

          <Card className="border-none shadow-sm bg-white">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Tag className="w-4 h-4" />
                最高支出分類
              </CardDescription>
              <CardTitle className="text-3xl font-bold text-slate-900">{topCategory}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="bg-slate-100 p-1">
            <TabsTrigger value="overview" className="data-[state=active]:bg-white">
              總覽
            </TabsTrigger>
            <TabsTrigger value="transactions" className="data-[state=active]:bg-white">
              交易明細
            </TabsTrigger>
            <TabsTrigger value="advice" className="data-[state=active]:bg-white">
              AI 建議
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="border-none shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PieChartIcon className="w-5 h-5 text-indigo-500" />
                    消費分類
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        cx="50%"
                        cy="50%"
                        innerRadius={80}
                        outerRadius={120}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {categoryData.map((entry, index) => (
                          <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => `$${value.toLocaleString()}`} />
                      <Legend verticalAlign="bottom" height={36} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border-none shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-emerald-500" />
                    每月支出趨勢
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#64748B" }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748B" }} />
                      <Tooltip formatter={(value: number) => `$${value.toLocaleString()}`} />
                      <Bar dataKey="amount" fill="#6366F1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="transactions">
            <Card className="border-none shadow-sm">
              <ScrollArea className="h-[600px] rounded-md">
                <div className="p-6 space-y-8">
                  {analyses.map((analysis) => (
                    <div key={analysis.month} className="space-y-4">
                      <div className="flex items-center justify-between border-b pb-2">
                        <h3 className="text-lg font-bold text-slate-800">{analysis.month} 帳單</h3>
                        <Badge variant="secondary" className="bg-indigo-50 text-indigo-600 border-none">
                          ${analysis.totalAmount.toLocaleString()}
                        </Badge>
                      </div>

                      <p className="text-sm text-slate-500">{analysis.summary}</p>

                      <div className="grid grid-cols-1 gap-3">
                        {analysis.transactions.map((transaction, index) => (
                          <div
                            key={`${analysis.month}-${transaction.merchant}-${index}`}
                            className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                          >
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm">
                                <CreditCard className="w-5 h-5 text-slate-400" />
                              </div>
                              <div>
                                <p className="font-medium text-slate-900">{transaction.merchant}</p>
                                <p className="text-xs text-slate-500">
                                  {transaction.date} ・ {transaction.category}
                                </p>
                              </div>
                            </div>
                            <p className="font-bold text-slate-900">
                              ${transaction.amount.toLocaleString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </Card>
          </TabsContent>

          <TabsContent value="advice">
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-indigo-500" />
                  AI 理財建議
                </CardTitle>
                <CardDescription>根據帳單結果整理出較容易採取的支出觀察與建議。</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="prose prose-slate max-w-none whitespace-pre-wrap text-slate-700 leading-relaxed">
                  {advice || "目前還沒有足夠資料可以產生理財建議。"}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
