# 📦 ビルド手順

このドキュメントでは、図面検索システムを実行可能ファイル(.app/.exe)にビルドする方法を説明します。

## 🎯 ゴール

Dropbox共有フォルダに配置して、ダブルクリックで起動できるアプリを作成します。

```
Dropbox/
└── 図面検索システム/
    ├── 図面検索システム.app (Mac) または .exe (Windows)
    └── data/  ← アプリ起動時に自動作成される
        ├── drawings.db
        └── files/
```

## 📋 必要なもの

- Node.js (v16以上推奨)
- npm

## 🚀 ビルド手順

### 1. 依存パッケージのインストール

初回のみ実行:

```bash
cd "/Users/nishitanitoshihiko/Downloads/v2.0 2/drawing-search-system"
npm install
```

これにより、以下がインストールされます:
- Electron
- electron-builder
- その他の依存パッケージ

### 2. ビルドの実行

#### macOS用アプリ

```bash
npm run build:mac
```

**生成されるファイル:**
- `dist/図面検索システム-1.0.0.dmg` (インストーラー)
- `dist/図面検索システム-1.0.0-mac.zip` (ZIPアーカイブ)
- `dist/mac/図面検索システム.app` (実行可能アプリ)

#### Windows用アプリ (macOS上でもビルド可能)

```bash
npm run build:win
```

**生成されるファイル:**
- `dist/図面検索システム Setup 1.0.0.exe` (インストーラー)
- `dist/図面検索システム 1.0.0.exe` (ポータブル版 - こちらを推奨)

#### 両方同時にビルド

```bash
npm run build
```

### 3. Dropbox共有フォルダへの配置

ビルドが完了したら、実行可能ファイルをDropboxにコピーします。

#### macOS の場合

```bash
# Dropboxフォルダを作成
mkdir -p ~/Dropbox/図面検索システム

# .appファイルをコピー
cp -r "dist/mac/図面検索システム.app" ~/Dropbox/図面検索システム/
```

#### Windows の場合

1. エクスプローラーで `dist` フォルダを開く
2. `図面検索システム 1.0.0.exe` (ポータブル版) をコピー
3. Dropbox共有フォルダに貼り付け

## ✅ 動作確認

1. Dropbox共有フォルダを開く
2. アプリアイコンをダブルクリック
3. アプリが起動すれば成功！

## 📝 注意事項

### macOS の場合

初回起動時に「開発元が未確認のため開けません」と表示される場合:

1. アプリを右クリック（または Control + クリック）
2. 「開く」を選択
3. 「開く」をクリック

または、以下のコマンドで署名なしアプリを許可:

```bash
xattr -cr ~/Dropbox/図面検索システム/図面検索システム.app
```

### Windows の場合

初回起動時に Windows Defender SmartScreen が表示される場合:

1. 「詳細情報」をクリック
2. 「実行」をクリック

## 🔧 トラブルシューティング

### ビルドエラーが発生する

**原因**: 依存パッケージが正しくインストールされていない

**対処法**:
```bash
rm -rf node_modules package-lock.json
npm install
npm run build:mac
```

### better-sqlite3 のビルドエラー

**原因**: ネイティブモジュールのリビルドが必要

**対処法**:
electron-builder が自動的に処理しますが、エラーが出る場合:
```bash
npm install --save-dev electron-rebuild
```

### アプリが起動しない

**原因1**: データベースファイルの権限エラー
- **対処法**: `data` フォルダを削除してアプリを再起動

**原因2**: ポートが使用中
- **対処法**: 他の図面検索システムが起動していないか確認

## 📦 配布

### DMGファイル (macOS)

`dist/図面検索システム-1.0.0.dmg` を配布すると、受け取った人はダブルクリックでインストールできます。

### EXEファイル (Windows)

**インストーラー版**: `dist/図面検索システム Setup 1.0.0.exe`
- ユーザーのPCにインストールされる
- スタートメニューに追加される

**ポータブル版 (推奨)**: `dist/図面検索システム 1.0.0.exe`
- インストール不要
- USBメモリやDropboxから直接起動可能
- **Dropbox共有にはこちらを推奨**

## 🎉 まとめ

1. `npm install` で依存パッケージをインストール
2. `npm run build:mac` または `npm run build:win` でビルド
3. 生成された実行ファイルをDropbox共有フォルダにコピー
4. ダブルクリックで起動！

---

詳しくは [README.md](README.md) を参照してください。
