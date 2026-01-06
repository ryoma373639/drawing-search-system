const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Expressサーバーを同じプロセス内で起動
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const Database = require('better-sqlite3');

let mainWindow;
let server;
let db;

// データ保存ディレクトリ
// アプリと同じディレクトリにdataフォルダを作成（Dropbox共有対応）
const appDir = app.isPackaged
  ? path.dirname(app.getPath('exe'))  // パッケージ化されている場合
  : __dirname;                         // 開発環境の場合

const dataDir = path.join(appDir, 'data');
const dbPath = path.join(dataDir, 'drawings.db');
const filesDir = path.join(dataDir, 'files');

// データディレクトリを作成
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(filesDir)) {
  fs.mkdirSync(filesDir, { recursive: true });
}

// データベース初期化
function initDatabase() {
  db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS drawings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fileName TEXT NOT NULL,
      fileSize INTEGER,
      fileType TEXT,
      filePath TEXT,
      drawingNumber TEXT,
      productName TEXT,
      partName TEXT,
      clientName TEXT,
      extractedText TEXT,
      uploadedAt TEXT
    )
  `);

  // 既存のテーブルにextractedTextカラムがない場合は追加
  const columns = db.prepare("PRAGMA table_info(drawings)").all();
  const hasExtractedText = columns.some(col => col.name === 'extractedText');
  if (!hasExtractedText) {
    db.exec('ALTER TABLE drawings ADD COLUMN extractedText TEXT');
    console.log('extractedTextカラムを追加しました');
  }

  // FTS5 全文検索インデックスを作成
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS drawings_fts USING fts5(
      fileName,
      drawingNumber,
      productName,
      partName,
      clientName,
      extractedText,
      content=drawings,
      content_rowid=id,
      tokenize='unicode61 remove_diacritics 2'
    )
  `);

  // FTS5インデックスを自動更新するトリガー
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS drawings_ai AFTER INSERT ON drawings BEGIN
      INSERT INTO drawings_fts(rowid, fileName, drawingNumber, productName, partName, clientName, extractedText)
      VALUES (new.id, new.fileName, new.drawingNumber, new.productName, new.partName, new.clientName, new.extractedText);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS drawings_ad AFTER DELETE ON drawings BEGIN
      INSERT INTO drawings_fts(drawings_fts, rowid, fileName, drawingNumber, productName, partName, clientName, extractedText)
      VALUES('delete', old.id, old.fileName, old.drawingNumber, old.productName, old.partName, old.clientName, old.extractedText);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS drawings_au AFTER UPDATE ON drawings BEGIN
      INSERT INTO drawings_fts(drawings_fts, rowid, fileName, drawingNumber, productName, partName, clientName, extractedText)
      VALUES('delete', old.id, old.fileName, old.drawingNumber, old.productName, old.partName, old.clientName, old.extractedText);
      INSERT INTO drawings_fts(rowid, fileName, drawingNumber, productName, partName, clientName, extractedText)
      VALUES (new.id, new.fileName, new.drawingNumber, new.productName, new.partName, new.clientName, new.extractedText);
    END;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS drawing_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drawingId INTEGER NOT NULL,
      tagId INTEGER NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (drawingId) REFERENCES drawings (id) ON DELETE CASCADE,
      FOREIGN KEY (tagId) REFERENCES tags (id) ON DELETE CASCADE,
      UNIQUE (drawingId, tagId)
    )
  `);

  console.log('データベース初期化完了:', dbPath);
  console.log('ファイル保存先:', filesDir);
}

function startServer() {
  const expressApp = express();
  const PORT = 3001;

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
  expressApp.use(express.static(path.join(__dirname, 'public')));
  expressApp.use(express.json());

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
  expressApp.post('/api/upload', upload.array('files'), async (req, res) => {
    try {
      const files = req.files;

      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'ファイルがアップロードされていません' });
      }

      // OCRテキストを受け取る（フロントエンドから送信される）
      let ocrTexts = {};
      if (req.body.ocrTexts) {
        try {
          ocrTexts = JSON.parse(req.body.ocrTexts);
        } catch (e) {
          console.error('OCR texts parse error:', e);
        }
      }

      const results = [];
      const insert = db.prepare(`
        INSERT INTO drawings (fileName, fileSize, fileType, filePath, drawingNumber, productName, partName, clientName, extractedText, uploadedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
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
        // 画像の場合はフロントエンドから送られたOCRテキストを使用
        else if (['.jpg', '.jpeg', '.png', '.tiff', '.tif'].includes(fileExt)) {
          const ocrText = ocrTexts[file.originalname] || '';
          if (ocrText) {
            extractedText = ocrText;
            partName = extractPartName(extractedText);
            clientName = extractClientName(extractedText);
          }
        }

        // ファイルをディスクに保存
        const timestamp = Date.now();
        const safeFileName = `${timestamp}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const filePath = path.join(filesDir, safeFileName);
        fs.writeFileSync(filePath, file.buffer);

        // データベースに登録
        const info = insert.run(
          file.originalname,
          file.size,
          fileExt.replace('.', ''),
          filePath,
          drawingNumber,
          productName,
          partName,
          clientName,
          extractedText,
          new Date().toISOString()
        );

        results.push({
          id: info.lastInsertRowid,
          fileName: file.originalname,
          drawingNumber: drawingNumber,
          productName: productName
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
  expressApp.get('/api/search', (req, res) => {
    try {
      const query = req.query.q || '';
      const sortBy = req.query.sortBy || 'id';
      const sortOrder = req.query.sortOrder || 'desc';
      const fileType = req.query.fileType || '';
      const tagId = req.query.tagId || ''; // タグフィルター

      // ソート項目のバリデーション
      const allowedSortFields = ['id', 'fileName', 'fileSize', 'uploadedAt', 'drawingNumber', 'fileType', 'rank'];
      const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'id';

      // ソート順序のバリデーション
      const sortDirection = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

      let sql;
      let params = [];
      let results;

      // 検索クエリがある場合はFTS5を使用
      if (query.trim()) {
        // FTS5の検索クエリを構築（特殊文字をエスケープ）
        const ftsQuery = query.trim().replace(/"/g, '""');

        // FTS5で検索して、関連度順にソート
        let baseSql = `
          SELECT
            d.id, d.fileName, d.fileType, d.fileSize, d.drawingNumber,
            d.productName, d.partName, d.clientName, d.uploadedAt,
            fts.rank
          FROM drawings d
          JOIN drawings_fts fts ON d.id = fts.rowid
          WHERE drawings_fts MATCH ?
        `;

        params.push(ftsQuery);

        // ファイルタイプフィルター
        if (fileType) {
          baseSql += ' AND d.fileType = ?';
          params.push(fileType);
        }

        // タグフィルター
        if (tagId) {
          baseSql += ' AND d.id IN (SELECT drawingId FROM drawing_tags WHERE tagId = ?)';
          params.push(parseInt(tagId));
        }

        // ソート（デフォルトはFTS5のランク順）
        if (sortField === 'rank' || sortField === 'id') {
          baseSql += ` ORDER BY fts.rank, d.${sortField} ${sortDirection}`;
        } else {
          baseSql += ` ORDER BY d.${sortField} ${sortDirection}`;
        }

        baseSql += ' LIMIT 100';
        sql = baseSql;

        results = db.prepare(sql).all(...params);

      } else {
        // 検索クエリがない場合は通常のクエリ
        let whereClause = '';

        // ファイルタイプフィルター
        if (fileType) {
          whereClause = 'WHERE fileType = ?';
          params.push(fileType);
        }

        // タグフィルター
        if (tagId) {
          const tagFilterClause = 'id IN (SELECT drawingId FROM drawing_tags WHERE tagId = ?)';
          if (whereClause) {
            whereClause += ` AND ${tagFilterClause}`;
          } else {
            whereClause = `WHERE ${tagFilterClause}`;
          }
          params.push(parseInt(tagId));
        }

        sql = `
          SELECT id, fileName, fileType, fileSize, drawingNumber, productName, partName, clientName, uploadedAt
          FROM drawings
          ${whereClause}
          ORDER BY ${sortField} ${sortDirection}
          LIMIT 100
        `;

        results = db.prepare(sql).all(...params);
      }

      // 各図面のタグを取得
      const resultsWithTags = results.map(drawing => {
        const tags = db.prepare(`
          SELECT t.* FROM tags t
          JOIN drawing_tags dt ON dt.tagId = t.id
          WHERE dt.drawingId = ?
          ORDER BY t.name ASC
        `).all(drawing.id);

        return { ...drawing, tags };
      });

      res.json({ results: resultsWithTags, total: resultsWithTags.length });

    } catch (error) {
      console.error('Search error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ファイルダウンロードAPI
  expressApp.get('/api/download/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const drawing = db.prepare('SELECT * FROM drawings WHERE id = ?').get(id);

      if (!drawing) {
        return res.status(404).json({ error: 'ファイルが見つかりません' });
      }

      // ファイルを読み込んで送信
      const fileBuffer = fs.readFileSync(drawing.filePath);

      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(drawing.fileName)}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(fileBuffer);

    } catch (error) {
      console.error('Download error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ファイルプレビューAPI
  expressApp.get('/api/preview/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const drawing = db.prepare('SELECT * FROM drawings WHERE id = ?').get(id);

      if (!drawing) {
        return res.status(404).json({ error: 'ファイルが見つかりません' });
      }

      // ファイルを読み込んで送信
      const fileBuffer = fs.readFileSync(drawing.filePath);

      // ファイルタイプに応じたContent-Typeを設定
      const contentTypes = {
        'pdf': 'application/pdf',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'tiff': 'image/tiff',
        'tif': 'image/tiff',
        'dwg': 'application/octet-stream',
        'dxf': 'application/dxf'
      };

      const contentType = contentTypes[drawing.fileType] || 'application/octet-stream';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(drawing.fileName)}"`);
      res.send(fileBuffer);

    } catch (error) {
      console.error('Preview error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // メタデータ更新API
  expressApp.put('/api/drawing/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { drawingNumber, productName, partName, clientName } = req.body;

      // ファイルが存在するか確認
      const drawing = db.prepare('SELECT * FROM drawings WHERE id = ?').get(id);

      if (!drawing) {
        return res.status(404).json({ error: 'ファイルが見つかりません' });
      }

      // バリデーション（オプショナルフィールドなので空文字も許可）
      const updates = {
        drawingNumber: drawingNumber !== undefined ? String(drawingNumber).trim() : drawing.drawingNumber,
        productName: productName !== undefined ? String(productName).trim() : drawing.productName,
        partName: partName !== undefined ? String(partName).trim() : drawing.partName,
        clientName: clientName !== undefined ? String(clientName).trim() : drawing.clientName
      };

      // データベースを更新
      db.prepare(`
        UPDATE drawings
        SET drawingNumber = ?, productName = ?, partName = ?, clientName = ?
        WHERE id = ?
      `).run(
        updates.drawingNumber,
        updates.productName,
        updates.partName,
        updates.clientName,
        id
      );

      // 更新後のデータを取得
      const updatedDrawing = db.prepare('SELECT * FROM drawings WHERE id = ?').get(id);

      res.json({
        success: true,
        message: 'メタデータを更新しました',
        drawing: {
          id: updatedDrawing.id,
          fileName: updatedDrawing.fileName,
          fileType: updatedDrawing.fileType,
          fileSize: updatedDrawing.fileSize,
          drawingNumber: updatedDrawing.drawingNumber,
          productName: updatedDrawing.productName,
          partName: updatedDrawing.partName,
          clientName: updatedDrawing.clientName,
          uploadedAt: updatedDrawing.uploadedAt
        }
      });

    } catch (error) {
      console.error('Update error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 統計情報API
  expressApp.get('/api/stats', (req, res) => {
    try {
      const count = db.prepare('SELECT COUNT(*) as total FROM drawings').get();
      const latest = db.prepare('SELECT uploadedAt FROM drawings ORDER BY id DESC LIMIT 1').get();

      res.json({
        totalFiles: count.total,
        lastUploaded: latest ? latest.uploadedAt : null
      });
    } catch (error) {
      console.error('Stats error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // CSVエクスポートAPI
  expressApp.get('/api/export/csv', (req, res) => {
    try {
      const query = req.query.q || '';
      const sortBy = req.query.sortBy || 'id';
      const sortOrder = req.query.sortOrder || 'desc';
      const fileType = req.query.fileType || '';

      // ソート項目のバリデーション
      const allowedSortFields = ['id', 'fileName', 'fileSize', 'uploadedAt', 'drawingNumber', 'fileType'];
      const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'id';
      const sortDirection = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

      // WHERE句の構築
      let whereClause = '';
      let params = [];

      if (query.trim()) {
        whereClause = 'WHERE (fileName LIKE ? OR drawingNumber LIKE ? OR productName LIKE ? OR partName LIKE ? OR clientName LIKE ?)';
        const searchTerm = `%${query.trim()}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      }

      if (fileType) {
        if (whereClause) {
          whereClause += ' AND fileType = ?';
        } else {
          whereClause = 'WHERE fileType = ?';
        }
        params.push(fileType);
      }

      // SQLクエリの実行
      const sql = `
        SELECT id, fileName, fileType, fileSize, drawingNumber, productName, partName, clientName, uploadedAt
        FROM drawings
        ${whereClause}
        ORDER BY ${sortField} ${sortDirection}
      `;

      const results = db.prepare(sql).all(...params);

      // CSVヘッダー（UTF-8 BOM付き）
      const BOM = '\uFEFF';
      let csv = BOM + 'ID,ファイル名,ファイル形式,ファイルサイズ(bytes),図版番号,品名,部品名,施主名,登録日時\n';

      // CSV本文
      results.forEach(row => {
        const line = [
          row.id,
          escapeCsvField(row.fileName),
          escapeCsvField(row.fileType),
          row.fileSize || '',
          escapeCsvField(row.drawingNumber),
          escapeCsvField(row.productName),
          escapeCsvField(row.partName),
          escapeCsvField(row.clientName),
          escapeCsvField(row.uploadedAt)
        ].join(',');
        csv += line + '\n';
      });

      // CSVとしてレスポンス
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `drawings_${timestamp}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);

    } catch (error) {
      console.error('CSV export error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // CSV用のフィールドエスケープ関数
  function escapeCsvField(field) {
    if (field === null || field === undefined) return '';
    const str = String(field);
    // ダブルクォート、カンマ、改行を含む場合はダブルクォートで囲む
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  // 個別削除API
  expressApp.delete('/api/drawing/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // ファイル情報を取得
      const drawing = db.prepare('SELECT * FROM drawings WHERE id = ?').get(id);

      if (!drawing) {
        return res.status(404).json({ error: 'ファイルが見つかりません' });
      }

      // ファイルシステムからファイルを削除
      try {
        if (fs.existsSync(drawing.filePath)) {
          fs.unlinkSync(drawing.filePath);
          console.log(`File deleted: ${drawing.filePath}`);
        }
      } catch (err) {
        console.error('File delete error:', err);
        return res.status(500).json({ error: 'ファイルの削除に失敗しました' });
      }

      // データベースからレコードを削除
      db.prepare('DELETE FROM drawings WHERE id = ?').run(id);

      res.json({
        success: true,
        message: `${drawing.fileName} を削除しました`,
        deletedId: id
      });

    } catch (error) {
      console.error('Delete error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 全削除API
  expressApp.delete('/api/clear', (req, res) => {
    try {
      // すべてのファイルを削除
      const drawings = db.prepare('SELECT filePath FROM drawings').all();
      drawings.forEach(drawing => {
        try {
          if (fs.existsSync(drawing.filePath)) {
            fs.unlinkSync(drawing.filePath);
          }
        } catch (err) {
          console.error('File delete error:', err);
        }
      });

      // データベースをクリア
      db.prepare('DELETE FROM drawings').run();
      db.prepare('DELETE FROM sqlite_sequence WHERE name = "drawings"').run();

      res.json({ success: true, message: '全てのデータを削除しました' });
    } catch (error) {
      console.error('Clear error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // タグAPI: 全タグ取得
  expressApp.get('/api/tags', (req, res) => {
    try {
      const tags = db.prepare('SELECT * FROM tags ORDER BY name ASC').all();
      res.json({ tags });
    } catch (error) {
      console.error('Get tags error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // タグAPI: タグ作成
  expressApp.post('/api/tags', (req, res) => {
    try {
      const { name } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'タグ名を入力してください' });
      }

      const trimmedName = name.trim();

      // 既存チェック
      const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(trimmedName);
      if (existing) {
        return res.status(400).json({ error: 'このタグは既に存在します' });
      }

      const result = db.prepare('INSERT INTO tags (name) VALUES (?)').run(trimmedName);
      const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid);

      res.json({ success: true, tag });
    } catch (error) {
      console.error('Create tag error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // タグAPI: タグ削除
  expressApp.delete('/api/tags/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // drawing_tagsも自動削除される（CASCADE）
      db.prepare('DELETE FROM tags WHERE id = ?').run(id);

      res.json({ success: true, message: 'タグを削除しました' });
    } catch (error) {
      console.error('Delete tag error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 図面タグAPI: 図面のタグ取得
  expressApp.get('/api/drawing/:id/tags', (req, res) => {
    try {
      const drawingId = parseInt(req.params.id);

      const tags = db.prepare(`
        SELECT t.* FROM tags t
        JOIN drawing_tags dt ON dt.tagId = t.id
        WHERE dt.drawingId = ?
        ORDER BY t.name ASC
      `).all(drawingId);

      res.json({ tags });
    } catch (error) {
      console.error('Get drawing tags error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 図面タグAPI: 図面にタグを追加
  expressApp.post('/api/drawing/:id/tags', (req, res) => {
    try {
      const drawingId = parseInt(req.params.id);
      const { tagId } = req.body;

      if (!tagId) {
        return res.status(400).json({ error: 'タグIDが必要です' });
      }

      // 既に追加されているかチェック
      const existing = db.prepare('SELECT id FROM drawing_tags WHERE drawingId = ? AND tagId = ?').get(drawingId, tagId);
      if (existing) {
        return res.status(400).json({ error: 'このタグは既に追加されています' });
      }

      db.prepare('INSERT INTO drawing_tags (drawingId, tagId) VALUES (?, ?)').run(drawingId, tagId);

      res.json({ success: true, message: 'タグを追加しました' });
    } catch (error) {
      console.error('Add tag to drawing error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 図面タグAPI: 図面からタグを削除
  expressApp.delete('/api/drawing/:drawingId/tag/:tagId', (req, res) => {
    try {
      const drawingId = parseInt(req.params.drawingId);
      const tagId = parseInt(req.params.tagId);

      db.prepare('DELETE FROM drawing_tags WHERE drawingId = ? AND tagId = ?').run(drawingId, tagId);

      res.json({ success: true, message: 'タグを削除しました' });
    } catch (error) {
      console.error('Remove tag from drawing error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // サーバー起動
  return new Promise((resolve, reject) => {
    server = expressApp.listen(PORT, () => {
      console.log(`\n========================================`);
      console.log(`  図面検索システム`);
      console.log(`========================================`);
      console.log(`  🌐 サーバー起動: http://localhost:${PORT}`);
      console.log(`  💾 データ保存先: ${filesDir}`);
      console.log(`========================================\n`);
      resolve();
    }).on('error', (err) => {
      console.error('サーバー起動エラー:', err);
      if (err.code === 'EADDRINUSE') {
        console.log(`ポート ${PORT} は既に使用されています。アプリを再起動してください。`);
      }
      reject(err);
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    title: '図面検索システム'
  });

  // サーバーが起動するまで待ってからロード
  waitForServer(() => {
    mainWindow.loadURL('http://localhost:3001');
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function waitForServer(callback) {
  const checkServer = () => {
    http.get('http://localhost:3001', (res) => {
      console.log('サーバー起動確認: ステータス', res.statusCode);
      callback();
    }).on('error', (err) => {
      console.log('サーバー待機中...');
      setTimeout(checkServer, 200);
    });
  };
  checkServer();
}

app.whenReady().then(async () => {
  try {
    initDatabase();
    await startServer();
    createWindow();
  } catch (error) {
    console.error('アプリ起動エラー:', error);
    app.quit();
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  // macOSでは×ボタンでウィンドウを閉じてもアプリは動作し続ける
  // サーバーは停止しない
  if (process.platform !== 'darwin') {
    // Windows/Linuxでは完全終了
    if (server) {
      server.close(() => {
        console.log('サーバーを停止しました');
      });
    }
    if (db) {
      db.close();
    }
    app.quit();
  }
  // macOSの場合は何もしない（サーバーは動作し続ける）
});

app.on('before-quit', () => {
  // アプリを完全に終了する時だけサーバーを停止
  if (server) {
    server.close(() => {
      console.log('サーバーを停止しました（アプリ終了前）');
    });
  }
  if (db) {
    db.close();
    console.log('データベースを閉じました');
  }
});
