import { GoogleGenAI, Type } from "@google/genai";

let genAI: GoogleGenAI | null = null;

function getGenAI() {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set in environment variables.");
    }
    genAI = new GoogleGenAI({ apiKey });
  }

  return genAI;
}

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

export interface AnalysisAttempt {
  analysis: StatementAnalysis | null;
  error?: string;
}

const statementSchema = {
  type: Type.OBJECT,
  properties: {
    month: { type: Type.STRING, description: "Statement month in YYYY-MM format. Use unknown if unavailable." },
    totalAmount: { type: Type.NUMBER, description: "Total amount mentioned in the document. Use 0 if unknown." },
    transactions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING, description: "Transaction date or unknown." },
          merchant: { type: Type.STRING, description: "Merchant or item description." },
          amount: { type: Type.NUMBER, description: "Transaction amount. Use 0 if unavailable." },
          category: {
            type: Type.STRING,
            enum: ["Food", "Transport", "Shopping", "Entertainment", "Utilities", "Others"],
          },
        },
        required: ["date", "merchant", "amount", "category"],
      },
    },
    summary: { type: Type.STRING, description: "Short Traditional Chinese summary of what this statement contains." },
  },
  required: ["month", "totalAmount", "transactions", "summary"],
} as const;

function normalizeModelJson(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const withoutFence = trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    return withoutFence;
  }
  return trimmed;
}

export async function analyzeEmailContent(
  emailBody: string,
  subject: string,
): Promise<AnalysisAttempt> {
  try {
    const ai = getGenAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `
You are analyzing Taiwanese bank, securities, or credit-card statement emails and PDF text.

Subject:
${subject}

Document text:
${emailBody}

Instructions:
1. If this is a financial statement, monthly statement, billing statement, securities statement, or account summary, extract what you can.
2. If exact transactions are unavailable, return an empty transactions array instead of failing.
3. If the total amount is unavailable, use 0.
4. If the month is unavailable, use "unknown".
5. Write the summary in Traditional Chinese used in Taiwan.
6. Return valid JSON only.
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: statementSchema,
        temperature: 0.2,
      },
    });

    if (!response.text) {
      return { analysis: null, error: "Model returned empty text." };
    }

    const parsed = JSON.parse(normalizeModelJson(response.text)) as StatementAnalysis;
    return { analysis: parsed };
  } catch (error: any) {
    console.error("Gemini analysis error:", error);
    return { analysis: null, error: error?.message || "Unknown Gemini analysis error." };
  }
}

export async function provideFinancialAdvice(allData: StatementAnalysis[]): Promise<string> {
  try {
    const ai = getGenAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `
Based on the following spending data from multiple months, provide a practical financial review in Traditional Chinese used in Taiwan.

Focus on:
1. Spending trends.
2. Categories with the largest expenses.
3. Reasonable cost-saving suggestions.
4. Any unusual changes worth checking.

Data: ${JSON.stringify(allData)}
      `,
      config: {
        systemInstruction:
          "你是台灣使用者的理財助理。請用清楚、具體、可執行的繁體中文回答，避免誇大與過度推論。",
        temperature: 0.3,
      },
    });

    return response.text || "目前沒有足夠資料可提供理財建議。";
  } catch (error) {
    console.error("Gemini advice error:", error);
    return "暫時無法產生理財建議，請稍後再試。";
  }
}
