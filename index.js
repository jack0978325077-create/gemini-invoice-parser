import { GoogleGenAI } from '@google/generative-ai';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// 1. 初始化 Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 2. 輔助函數：將本機圖片轉為 Gemini 可讀的格式
function fileToGenerativePart(filePath, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
      mimeType
    },
  };
}

async function main() {
  const imageFolder = './images';
  
  // 檢查本機有沒有 images 資料夾
  if (!fs.existsSync(imageFolder)){
    fs.mkdirSync(imageFolder);
    console.log('👉 已為您建立 ./images 資料夾，請把銷貨單照片放進去後重新執行！');
    return;
  }

  const files = fs.readdirSync(imageFolder).filter(file => /\.(jpg|jpeg|png)$/i.test(file));
  if (files.length === 0) {
    console.log('ℹ️ ./images 資料夾裡面沒有照片喔！');
    return;
  }

  const targetFile = files[0];
  const filePath = path.join(imageFolder, targetFile);
  console.log(`🚀 正在處理本機照片: ${targetFile}...`);

  // 3. 呼叫 Gemini 1.5 Flash 辨識
  const model = ai.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: { responseMimeType: "application/json", temperature: 0 }
  });

  const prompt = `你是一位經驗極其豐富的會計賬務稽核專家。請辨識這張上傳的出貨單照片，並用最高精度提取資料。
  【欄位提取嚴格規範】
  1. customer_name: 尋找客戶名稱、送貨客戶或收貨人。
  2. item_name: 完整提取商品名稱與規格（如：香甜甘栗）。
  3. quantity: 只輸出純數字出貨數量，忽略批號與日期，不要帶單位。
  4. amount: 抓取最右側總金額。如果沒寫，輸出 0。
  
  請完全「只」輸出符合以下格式的純 JSON 物件：
  {"customer_name": "客戶名稱", "items": [{"item_name": "品名", "quantity": 123, "amount": 456}]}`;

  const imagePart = fileToGenerativePart(filePath, "image/jpeg");

  try {
    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const data = JSON.parse(response.text());
    console.log('✅ Gemini 辨識成功！結果如下：', JSON.stringify(data, null, 2));

    // 4. 將資料寫入 Google Sheets
    // 注意：這裡需要您的 Google 服務帳號憑證 (credentials.json)
    const auth = new google.auth.GoogleAuth({
      keyFile: 'credentials.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const values = data.items.map(item => [
      new Date().toLocaleString(),
      targetFile,
      data.customer_name,
      item.item_name,
      item.quantity,
      item.amount
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: '工作表1!A:F', // 請根據您的工作表名稱修改
      valueInputOption: 'USER_ENTERED',
      resource: { values },
    });

    console.log('🎉 恭喜！資料已成功寫入 Google Sheets！');
    
    // 選擇性：處理完後把照片搬走或刪除
    fs.unlinkSync(filePath);
    console.log(`🗑️ 已自動清理本機已處理的照片: ${targetFile}`);

  } catch (error) {
    console.error('❌ 發生錯誤:', error);
  }
}

main();
