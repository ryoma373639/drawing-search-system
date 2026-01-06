// DOM要素
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const clearBtn = document.getElementById('clearBtn');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultsList = document.getElementById('resultsList');
const resultsCount = document.getElementById('resultsCount');
const noResults = document.getElementById('noResults');
const welcomeMessage = document.getElementById('welcomeMessage');
const statusText = document.getElementById('statusText');
const statsText = document.getElementById('statsText');

// 初期化
let isUploading = false;

// ファイルアップロードボタン
uploadBtn.addEventListener('click', () => {
  fileInput.click();
});

// ファイル選択
fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (files.length > 0) {
    await uploadFiles(files);
    fileInput.value = ''; // リセット
  }
});

// ドラッグ&ドロップ
uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('drag-over');
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('drag-over');
});

uploadArea.addEventListener('drop', async (e) => {
  e.preventDefault();
  uploadArea.classList.remove('drag-over');

  const files = Array.from(e.dataTransfer.files);
  if (files.length > 0) {
    await uploadFiles(files);
  }
});

// クリックでファイル選択
uploadArea.addEventListener('click', () => {
  if (!isUploading) {
    fileInput.click();
  }
});

// ファイルアップロード
async function uploadFiles(files) {
  if (isUploading) return;

  isUploading = true;
  statusText.textContent = `${files.length}件のファイルをアップロード中...`;

  try {
    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });

    // 画像ファイルがある場合は、ブラウザでOCR処理
    const imageFiles = files.filter(f => {
      const ext = f.name.toLowerCase();
      return ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.png') || ext.endsWith('.tiff') || ext.endsWith('.tif');
    });

    if (imageFiles.length > 0) {
      statusText.textContent = `画像からテキストを抽出中... (${imageFiles.length}件)`;
      // OCR処理は時間がかかるため、バックグラウンドで実行
      // ここでは簡易的にスキップ（本格実装時はTesseract.jsを使用）
    }

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.success) {
      statusText.textContent = data.message;
      welcomeMessage.style.display = 'none';
      updateStats();

      // 自動的に検索結果を更新
      await performSearch();

      // 3秒後にステータスをリセット
      setTimeout(() => {
        statusText.textContent = '準備完了';
      }, 3000);
    } else {
      statusText.textContent = 'エラー: ' + (data.error || '不明なエラー');
    }

  } catch (error) {
    console.error('Upload error:', error);
    statusText.textContent = 'アップロードに失敗しました';
  } finally {
    isUploading = false;
  }
}

// 統計情報更新
async function updateStats() {
  try {
    const response = await fetch('/api/stats');
    const data = await response.json();
    statsText.textContent = `登録済み: ${data.totalFiles}件`;
  } catch (error) {
    console.error('Stats error:', error);
  }
}

// 検索実行
async function performSearch() {
  const query = searchInput.value.trim();

  // ローディング表示
  resultsList.innerHTML = '<div class="loading">検索中</div>';
  noResults.style.display = 'none';
  welcomeMessage.style.display = 'none';

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await response.json();

    if (data.results.length === 0) {
      resultsList.innerHTML = '';
      noResults.style.display = 'block';
      resultsCount.textContent = '';
      return;
    }

    // 検索結果を表示
    displayResults(data.results);
    resultsCount.textContent = `${data.total}件`;

  } catch (error) {
    console.error('Search error:', error);
    resultsList.innerHTML = '<div style="text-align: center; padding: 40px; color: #f44336;">検索エラーが発生しました</div>';
  }
}

// 検索結果を表示
function displayResults(results) {
  resultsList.innerHTML = '';

  results.forEach(result => {
    const item = createResultItem(result);
    resultsList.appendChild(item);
  });
}

// 検索結果アイテムを作成
function createResultItem(result) {
  const div = document.createElement('div');
  div.className = 'result-item';

  // ファイルアイコン
  const icon = getFileIcon(result.fileType);

  // メタデータ
  const metaItems = [];

  if (result.drawingNumber) {
    metaItems.push(`<div class="meta-item"><span class="meta-label">図版:</span>${escapeHtml(result.drawingNumber)}</div>`);
  }

  if (result.productName) {
    metaItems.push(`<div class="meta-item"><span class="meta-label">品名:</span>${escapeHtml(result.productName)}</div>`);
  }

  if (result.partName) {
    metaItems.push(`<div class="meta-item"><span class="meta-label">部品名:</span>${escapeHtml(result.partName)}</div>`);
  }

  if (result.clientName) {
    metaItems.push(`<div class="meta-item"><span class="meta-label">施主:</span>${escapeHtml(result.clientName)}</div>`);
  }

  if (result.uploadedAt) {
    const date = new Date(result.uploadedAt);
    metaItems.push(`<div class="meta-item"><span class="meta-label">登録:</span>${date.toLocaleString('ja-JP')}</div>`);
  }

  const fileSize = formatFileSize(result.fileSize);
  if (fileSize) {
    metaItems.push(`<div class="meta-item"><span class="meta-label">サイズ:</span>${fileSize}</div>`);
  }

  div.innerHTML = `
    <div class="result-header">
      <div class="file-icon">${icon}</div>
      <div class="result-title">
        <h3>${escapeHtml(result.fileName)}</h3>
      </div>
    </div>
    <div class="result-meta">
      ${metaItems.join('')}
    </div>
    <div class="result-actions">
      <button class="action-btn download-btn" data-id="${result.id}">📥 ダウンロード</button>
      <button class="action-btn delete-btn" data-id="${result.id}">🗑️ 削除</button>
    </div>
  `;

  // ダウンロードボタン
  const downloadBtn = div.querySelector('.download-btn');
  downloadBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await downloadFile(result.id, result.fileName);
  });

  // 削除ボタン
  const deleteBtn = div.querySelector('.delete-btn');
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await deleteFile(result.id, result.fileName);
  });

  return div;
}

// ファイルダウンロード
async function downloadFile(id, fileName) {
  try {
    const response = await fetch(`/api/download/${id}`);
    const blob = await response.blob();

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    statusText.textContent = `${fileName} をダウンロードしました`;
    setTimeout(() => {
      statusText.textContent = '準備完了';
    }, 3000);

  } catch (error) {
    console.error('Download error:', error);
    alert('ダウンロードに失敗しました');
  }
}

// ファイル削除
async function deleteFile(id, fileName) {
  // 削除確認ダイアログ
  if (!confirm(`「${fileName}」を削除しますか？\n\nこの操作は取り消せません。`)) {
    return;
  }

  try {
    statusText.textContent = `${fileName} を削除中...`;

    const response = await fetch(`/api/drawing/${id}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (response.ok && data.success) {
      statusText.textContent = data.message;

      // 検索結果を自動更新
      await performSearch();

      // 統計情報を更新
      updateStats();

      setTimeout(() => {
        statusText.textContent = '準備完了';
      }, 3000);
    } else {
      throw new Error(data.error || '削除に失敗しました');
    }

  } catch (error) {
    console.error('Delete error:', error);
    statusText.textContent = '削除に失敗しました';
    alert(`削除エラー: ${error.message}`);

    setTimeout(() => {
      statusText.textContent = '準備完了';
    }, 3000);
  }
}

// ファイルタイプに応じたアイコン
function getFileIcon(fileType) {
  const icons = {
    'pdf': '📄',
    'dwg': '📐',
    'dxf': '📐',
    'jpg': '🖼️',
    'jpeg': '🖼️',
    'png': '🖼️',
    'tiff': '🖼️',
    'tif': '🖼️'
  };
  return icons[fileType] || '📄';
}

// ファイルサイズをフォーマット
function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// HTMLエスケープ
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 検索ボタン
searchBtn.addEventListener('click', performSearch);

// Enterキーで検索
searchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    performSearch();
  }
});

// 全削除ボタン
clearBtn.addEventListener('click', async () => {
  if (!confirm('全てのデータを削除しますか？\n（この操作は取り消せません）')) {
    return;
  }

  try {
    const response = await fetch('/api/clear', {
      method: 'DELETE'
    });

    const data = await response.json();

    if (data.success) {
      statusText.textContent = data.message;
      resultsList.innerHTML = '';
      welcomeMessage.style.display = 'block';
      noResults.style.display = 'none';
      resultsCount.textContent = '';
      updateStats();

      setTimeout(() => {
        statusText.textContent = '準備完了';
      }, 3000);
    }

  } catch (error) {
    console.error('Clear error:', error);
    alert('削除に失敗しました');
  }
});

// 初期化: 統計情報を取得
updateStats();
