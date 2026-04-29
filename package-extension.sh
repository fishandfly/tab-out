#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$SCRIPT_DIR/extension"
DIST_DIR="$SCRIPT_DIR/release"
STAGE_DIR="$DIST_DIR/gtd-new-tab"
MANIFEST_PATH="$EXT_DIR/manifest.json"

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "未找到扩展清单文件: $MANIFEST_PATH" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node，无法读取扩展版本号。" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "未找到 rsync，无法生成发布目录。" >&2
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "未找到 zip，无法打包压缩文件。" >&2
  exit 1
fi

VERSION="$(node -p 'require(process.argv[1]).version' "$MANIFEST_PATH")"
ZIP_NAME="gtd-new-tab-v${VERSION}.zip"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"

rm -rf "$STAGE_DIR"
mkdir -p "$DIST_DIR"

rsync -a \
  --delete \
  --exclude "tests" \
  --exclude ".DS_Store" \
  "$EXT_DIR/" "$STAGE_DIR/"

rm -f "$ZIP_PATH"
(
  cd "$DIST_DIR"
  zip -qr "$ZIP_NAME" "$(basename "$STAGE_DIR")"
)

echo "打包完成: $ZIP_PATH"
echo "安装方式:"
echo "1. 解压 zip"
echo "2. 打开 chrome://extensions"
echo "3. 开启开发者模式"
echo "4. 点击“加载已解压的扩展程序”"
echo "5. 选择解压后的 gtd-new-tab 目录"
