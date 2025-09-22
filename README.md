# Master Duel 戦績トラッカー（ローカル完結）

静的ホスティングで動くオフライン対応SPA。IndexedDBに保存し、外部通信なしで戦績の記録・集計・可視化が可能。

## ローカル実行

```
python3 -m http.server 8000
# http://localhost:8000/
```

## GitHub Pages デプロイ (CI/CD)

1. GitHubで空のリポジトリを作成（Public推奨）
2. ローカルから初回push

```
git init
git branch -M main
git remote add origin git@github.com:<YOUR_NAME>/<REPO>.git
git add -A
git commit -m "init: md-tracker proto"
git push -u origin main
```

3. Actions タブで "Deploy Pages" が自動実行 → 成功後、Pages のURLが表示されます

デプロイ方法は2通り用意しています。

- GitHub Actions 方式（推奨）: `.github/workflows/pages.yml`
  - リポジトリ Settings → Pages → Build and deployment: 「GitHub Actions」に設定
  - リポジトリ Settings → Actions → General → Workflow permissions: 「Read and write permissions」に設定
  - これで Actions が Pages サイトの有効化とデプロイを行います

- gh-pages ブランチ方式（代替）: `.github/workflows/pages-branch.yml`
  - Settings → Pages → Build and deployment: 「Deploy from a branch」
  - Branch: `gh-pages` / フォルダ: `/ (root)` を選択
  - `pages-branch.yml` により `main` から `gh-pages` へ静的ファイルを自動反映

どちらの方式でも、`sw.js` は相対パス登録のため `https://<user>.github.io/<repo>/` 配下で動作します。

更新反映について:
- 基本は「コミットして push するだけ」でOKです。Service Worker はコアアセット（`index.html`, `styles.css`, `src/*`, `sw.js`）を Network-first で取得し、常に最新版を取りに行きます（失敗時のみキャッシュにフォールバック）。
- オフライン時はキャッシュから表示されます。
- それでも切り替わらない場合は、ブラウザのハードリロードをお試しください。

## CI (静的チェック)

`.github/workflows/ci.yml` が以下を検査します:
- 必須ファイルの存在
- 外部URL参照の禁止（`http(s)://` を grep で検出し失敗）
- CSPメタタグの存在

## 仕様対応状況（抜粋）
- IndexedDB schema v2（projects/decks/tags/matches + tags_flat）
- プロジェクト/デッキ/タグ CRUD、対戦入力（タグ自由入力/マスタ参照）
- ダッシュボード: KPI と タグ別統計、タグフィルタ AND/OR
- JSON エクスポート/インポート（全体/プロジェクト/デッキのみ）
- Service Worker によるオフライン対応

今後: グラフ描画、マイグレーション精緻化、入力バリデーションの警告強化 等
