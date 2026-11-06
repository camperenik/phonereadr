#!/usr/bin/env bash
# Deploy ke GitHub Pages dengan mode "deploy dari branch".
# Pakai:  scripts/deploy-pages.sh [branch-pages]
#
# - Build dengan base path /<nama-repo>/
# - Mengganti isi root branch Pages dengan hasil build
# - Aplikasi PhoneReadr lama dipertahankan di legacy/ (jalur rollback; dipindah sekali saja)
# - /next/ (alamat uji lama) diganti halaman pengalih + service worker yang membersihkan dirinya
set -euo pipefail

PAGES_BRANCH="${1:-claude/iphone-pdf-reader-ucatys}"
ROOT="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$ROOT")"
SRC_SHA="$(git rev-parse --short HEAD)"

cd "$ROOT"
BASE_PATH="/${REPO_NAME}/" npm run build

WT="$(mktemp -d)"
trap 'cd "$ROOT"; git worktree remove --force "$WT" 2>/dev/null || true; git branch -D pages-deploy -q 2>/dev/null || true' EXIT

git fetch -q origin "$PAGES_BRANCH"
git worktree add -q -B pages-deploy "$WT" "origin/$PAGES_BRANCH"

cd "$WT"
# 1) simpan aplikasi lama di legacy/ (hanya jika belum)
if [ -f app.js ] && [ ! -d legacy ]; then
  mkdir legacy
  git mv app.js reflow.js parsers.js styles.css index.html manifest.webmanifest sw.js icon-180.png icon-512.png legacy/
  git mv vendor legacy/vendor
  [ -f README.md ] && git mv README.md legacy/README.md
fi

# 2) kosongkan build sebelumnya (kecuali .git, legacy/, .nojekyll), lalu salin build baru
find . -mindepth 1 -maxdepth 1 ! -name .git ! -name legacy ! -name .nojekyll -exec rm -rf {} +
cp -r "$ROOT/dist/." .
touch .nojekyll

# 3) /next/: pengalih ke aplikasi utama + SW yang membersihkan cache lama lalu mencabut dirinya
mkdir -p next
cat > next/index.html <<'HTML'
<!doctype html><html lang="id"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=../">
<title>PhoneReadr</title></head><body><p>Alamat ini sudah pindah. <a href="../">Buka PhoneReadr</a>.</p></body></html>
HTML
cat > next/sw.js <<'JS'
// Pembersih: menghapus cache aplikasi uji lama di /next/ lalu mencabut service worker ini.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.includes('/next/')) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate('../');
})()));
JS

git add -A
if git diff --cached --quiet; then echo "Tidak ada perubahan untuk di-deploy."; exit 0; fi
git commit -q -m "Deploy PhoneReadr gabungan (sumber $SRC_SHA)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YPsu2JPUtgUEHxfgvrz4Fs"
git push origin "pages-deploy:$PAGES_BRANCH"
echo "Selesai: build $SRC_SHA terkirim ke $PAGES_BRANCH."
