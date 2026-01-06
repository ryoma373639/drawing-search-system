const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const pdfParse = require('pdf-parse');

const app = express();
const PORT = 3001;

// インメモリストレージ（テスト用）
let drawings = [];
let nextId = 1;

// ファイルアップロード設定（メモリに保存）
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.dwg', '.dxf', '.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.tif'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('サポートされていないファイル形式です'));
    }
  }
});

// 静的ファイル配信
app.use(express.static('public'));
app.use(express.json());

// ファイル名から図版番号と品名を抽出
function parseFileName(fileName) {
  const nameWithoutExt = path.parse(fileName).name;
  const parts = nameWithoutExt.split('_');

  let drawingNumber = '';
  let productName = '';

  if (parts.length >= 2) {
    drawingNumber = parts[0].trim();
    productName = parts.slice(1).join('_').trim();
  } else if (parts.length === 1) {
    drawingNumber = parts[0].trim();
  }

  return { drawingNumber, productName };
}

// PDFからテキスト抽出
async function extractTextFromPDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    console.error('PDF extraction error:', error);
    return '';
  }
}

// テキストから部品名を抽出
function extractPartName(text) {
  const patterns = [
    /部品名[：:]\s*([^\n\r]+)/,
    /部品[：:]\s*([^\n\r]+)/,
    /品名[：:]\s*([^\n\r]+)/,
    /PART[：:]\s*([^\n\r]+)/i,
    /COMPONENT[：:]\s*([^\n\r]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim().substring(0, 100);
    }
  }
  return '';
}

// テキストから施主名を抽出
function extractClientName(text) {
  const patterns = [
    /施主[：:]\s*([^\n\r]+)/,
    /発注者[：:]\s*([^\n\r]+)/,
    /クライアント[：:]\s*([^\n\r]+)/,
    /CLIENT[：:]\s*([^\n\r]+)/i,
    /OWNER[：:]\s*([^\n\r]+)/i,
    /([^\n\r]*株式会社[^\n\r]*)/,
    /([^\n\r]*有限会社[^\n\r]*)/,
    /([^\n\r]*合同会社[^\n\r]*)/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim().substring(0, 100);
    }
  }
  return '';
}

// ファイルアップロードAPI
app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'ファイルがアップロードされていません' });
    }

    const results = [];

    for (const file of files) {
      const { drawingNumber, productName } = parseFileName(file.originalname);
      const fileExt = path.extname(file.originalname).toLowerCase();

      let extractedText = '';
      let partName = '';
      let clientName = '';

      // PDFの場合はテキスト抽出
      if (fileExt === '.pdf') {
        extractedText = await extractTextFromPDF(file.buffer);
        partName = extractPartName(extractedText);
        clientName = extractClientName(extractedText);
      }

      // 画像の場合はOCRが必要だが、ブラウザ側で処理するためスキップ
      // CADファイルも同様にスキップ

      const drawing = {
        id: nextId++,
        fileName: file.originalname,
        fileSize: file.size,
        fileType: fileExt.replace('.', ''),
        drawingNumber,
        productName,
        partName,
        clientName,
        uploadedAt: new Date().toISOString(),
        // ファイルデータをBase64エンコード（ダウンロード用）
        fileData: file.buffer.toString('base64')
      };

      drawings.push(drawing);
      results.push({
        id: drawing.id,
        fileName: drawing.fileName,
        drawingNumber: drawing.drawingNumber,
        productName: drawing.productName
      });
    }

    res.json({
      success: true,
      message: `${files.length}件のファイルを登録しました`,
      files: results
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 検索API
app.get('/api/search', (req, res) => {
  try {
    const query = req.query.q || '';

    if (!query.trim()) {
      // クエリが空の場合は全件返す（最新100件）
      const results = drawings
        .slice(-100)
        .reverse()
        .map(d => ({
          id: d.id,
          fileName: d.fileName,
          fileType: d.fileType,
          fileSize: d.fileSize,
          drawingNumber: d.drawingNumber,
          productName: d.productName,
          partName: d.partName,
          clientName: d.clientName,
          uploadedAt: d.uploadedAt
        }));
      return res.json({ results, total: results.length });
    }

    // 検索実行（シンプルな部分一致検索）
    const searchTerm = query.trim().toLowerCase();
    const results = drawings
      .filter(d => {
        return (
          (d.fileName && d.fileName.toLowerCase().includes(searchTerm)) ||
          (d.drawingNumber && d.drawingNumber.toLowerCase().includes(searchTerm)) ||
          (d.productName && d.productName.toLowerCase().includes(searchTerm)) ||
          (d.partName && d.partName.toLowerCase().includes(searchTerm)) ||
          (d.clientName && d.clientName.toLowerCase().includes(searchTerm))
        );
      })
      .slice(0, 100)
      .map(d => ({
        id: d.id,
        fileName: d.fileName,
        fileType: d.fileType,
        fileSize: d.fileSize,
        drawingNumber: d.drawingNumber,
        productName: d.productName,
        partName: d.partName,
        clientName: d.clientName,
        uploadedAt: d.uploadedAt
      }));

    res.json({ results, total: results.length });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ファイルダウンロードAPI
app.get('/api/download/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const drawing = drawings.find(d => d.id === id);

    if (!drawing) {
      return res.status(404).json({ error: 'ファイルが見つかりません' });
    }

    // Base64からBufferに変換
    const buffer = Buffer.from(drawing.fileData, 'base64');

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(drawing.fileName)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buffer);

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 統計情報API
app.get('/api/stats', (req, res) => {
  res.json({
    totalFiles: drawings.length,
    lastUploaded: drawings.length > 0 ? drawings[drawings.length - 1].uploadedAt : null
  });
});

// 全削除API（テスト用）
app.delete('/api/clear', (req, res) => {
  drawings = [];
  nextId = 1;
  res.json({ success: true, message: '全てのデータを削除しました' });
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  図面検索システム - テスト版`);
  console.log(`========================================`);
  console.log(`  🌐 ブラウザで開く: http://localhost:${PORT}`);
  console.log(`========================================\n`);
});
