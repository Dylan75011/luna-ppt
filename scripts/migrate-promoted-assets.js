// 一次性迁移脚本：把 data/docs/*.json 里仍然引用 output/runs/<runId>/... 的资产文件
// 搬到新布局 output/promoted/<docId>/，并重写 doc.json 中的路径字段。
//
// 历史背景：旧的 saveAssetToSpace / savePptToSpace 是"零拷贝"的 —— 只在 doc.json
// 里记录文件路径，文件本身留在 output/runs/<runId>/ 下。新方案改成"promote 时 mv"，
// 同时给会话引入 per-conversation tmp 目录，删会话时 rm -rf。为了让历史 doc 也跟上
// 新布局（不再被 pruneRuns 误删），这个脚本要跑一次。
//
// 用法：
//   node scripts/migrate-promoted-assets.js          # dry-run，只打印计划，不动文件
//   node scripts/migrate-promoted-assets.js --apply  # 真的执行
//
// 安全策略：
//   - 失败的条目不阻塞其他条目，最后给一份汇总
//   - 同名冲突自动加 (n) 后缀
//   - 跨设备 rename 自动 fallback 到 copy + unlink
//   - 改 doc.json 时走 atomic rename（writeFileSync 到 .tmp 再 renameSync），不会半写
//   - 新建立的 promoted/<docId>/ 目录会被 schemaVersion 注入器跳过（不是 doc.json）

const fs = require('fs');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));

const APPLY = process.argv.includes('--apply');
const DOCS_DIR = path.resolve('./data/docs');
const OUTPUT_ROOT = path.resolve('./output');
const PROMOTED_ROOT = path.join(OUTPUT_ROOT, 'promoted');
const RUNS_ROOT = path.join(OUTPUT_ROOT, 'runs');

function readDoc(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function writeDocAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function moveFile(src, dest) {
  ensureDir(path.dirname(dest));
  // 同名冲突
  let final = dest;
  if (fs.existsSync(final)) {
    const ext = path.extname(dest);
    const stem = dest.slice(0, dest.length - ext.length);
    let n = 1;
    while (fs.existsSync(final)) {
      final = `${stem} (${n})${ext}`;
      n += 1;
    }
  }
  try {
    fs.renameSync(src, final);
  } catch (error) {
    if (error && (error.code === 'EXDEV' || /cross-device/i.test(error.message))) {
      fs.copyFileSync(src, final);
      fs.unlinkSync(src);
    } else {
      throw error;
    }
  }
  return final;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function rewriteUrls(doc, newAbsPath) {
  const newRel = toPosix(path.relative(OUTPUT_ROOT, newAbsPath));
  const updated = { ...doc };
  updated.filePath = newAbsPath;
  updated.outputRelativePath = newRel;
  if (doc.downloadUrl) updated.downloadUrl = `/api/files/download/${newRel}`;
  if (doc.previewUrl && doc.previewUrl.startsWith('/output/')) {
    updated.previewUrl = `/output/${newRel}`;
  }
  return updated;
}

function main() {
  if (!fs.existsSync(DOCS_DIR)) {
    console.log('没有 data/docs 目录，无需迁移');
    return;
  }

  const docFiles = fs.readdirSync(DOCS_DIR).filter((n) => n.endsWith('.json'));
  const plan = []; // { docFile, docId, srcAbs, destAbs }
  const skipped = [];
  const errors = [];

  for (const docFile of docFiles) {
    const fullPath = path.join(DOCS_DIR, docFile);
    let doc;
    try {
      doc = readDoc(fullPath);
    } catch (error) {
      errors.push({ docFile, reason: 'JSON 解析失败: ' + error.message });
      continue;
    }
    const docId = doc.id || path.basename(docFile, '.json');
    const candidate = doc.filePath || doc.outputRelativePath;
    if (!candidate) {
      skipped.push({ docFile, reason: '无 filePath / outputRelativePath' });
      continue;
    }

    const srcAbs = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(OUTPUT_ROOT, candidate.replace(/^\/+/, '').replace(/^output\//, ''));

    // 已经在 promoted/<docId>/ 下：跳过
    if (srcAbs.startsWith(path.join(PROMOTED_ROOT, docId) + path.sep)) {
      skipped.push({ docFile, reason: '已在 promoted/<docId>/ 下' });
      continue;
    }
    // 不在 runs/ 下：跳过（可能是其他历史目录或外部路径，不动）
    if (!srcAbs.startsWith(RUNS_ROOT + path.sep)) {
      skipped.push({ docFile, reason: '路径不在 output/runs/ 下: ' + srcAbs });
      continue;
    }
    if (!fs.existsSync(srcAbs)) {
      skipped.push({ docFile, reason: '源文件已不存在: ' + srcAbs });
      continue;
    }

    const destAbs = path.join(PROMOTED_ROOT, docId, path.basename(srcAbs));
    plan.push({ docFile, docId, srcAbs, destAbs, fullPath, doc });
  }

  console.log(`扫描完成：${docFiles.length} 个 doc.json`);
  console.log(`  待迁移：${plan.length}`);
  console.log(`  跳过：${skipped.length}`);
  console.log(`  错误：${errors.length}`);
  if (skipped.length && process.env.VERBOSE) {
    skipped.forEach((s) => console.log('  - skip', s.docFile, '|', s.reason));
  }
  errors.forEach((e) => console.warn('  ! err', e.docFile, '|', e.reason));

  if (!APPLY) {
    console.log('\n(dry-run) 计划如下，加 --apply 真的执行：');
    plan.forEach((p) => {
      console.log(`  ${p.docId}`);
      console.log(`    src:  ${p.srcAbs}`);
      console.log(`    dest: ${p.destAbs}`);
    });
    return;
  }

  let done = 0;
  for (const item of plan) {
    try {
      const finalDest = moveFile(item.srcAbs, item.destAbs);
      const updated = rewriteUrls(item.doc, finalDest);
      writeDocAtomic(item.fullPath, updated);
      done += 1;
      console.log(`  ✓ ${item.docId} → ${path.relative(OUTPUT_ROOT, finalDest)}`);
    } catch (error) {
      console.error(`  ✗ ${item.docId}: ${error.message}`);
      errors.push({ docFile: item.docFile, reason: error.message });
    }
  }

  console.log(`\n迁移完成：${done}/${plan.length}`);
  if (errors.length) {
    console.warn(`遇到 ${errors.length} 个错误，请检查日志`);
    process.exitCode = 1;
  }
}

main();
