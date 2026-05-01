// 验证 per-conversation 临时区 + promoted 资产物理隔离方案：
//   1) 在 output/conversations/<convId>/runs/<runId>/<assetType>/ 落临时文件
//   2) saveAssetToSpace 把它 mv 到 output/promoted/<docId>/，doc.json 路径跟着改
//   3) cleanupConversationTmp 删除会话临时区，但 promoted/ 区不受影响
//   4) promoteFileToDoc 同名冲突自动加后缀，不覆盖
//   5) saveAssetToSpace 收到不存在的源路径时不崩，保留原值
//
// 用法：node scripts/smoke-tmp-isolation.js
// 不启 HTTP server，直接调模块；用临时 conversation/space，结束后清理。

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));

const conversationStore = require('../src/services/conversationStore');
const workspaceManager = require('../src/services/workspaceManager');
const {
  getConversationRunAssetDir,
  getConversationTmpDir,
  getPromotedDir,
  getOutputRoot,
  toOutputRelative,
} = require('../src/services/outputPaths');
const { cleanupConversationTmp } = require('../src/services/outputRetention');

const OUTPUT_ROOT = getOutputRoot();

function makeFile(absPath, content = 'hello') {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content);
  return absPath;
}

function freshConv(workspaceId = 'space_smoke_tmp_iso') {
  return conversationStore.createConversation(workspaceId, 'smoke tmp iso').id;
}

function ensureSpace(name = 'smoke tmp iso 临时空间') {
  const tree = workspaceManager.getTree();
  const found = (tree.spaces || []).find((s) => s.name === name);
  if (found) return found;
  return workspaceManager.createSpace(name);
}

function caseTmpLayout() {
  console.log('\n[case 1] per-conversation 临时区目录布局');
  const convId = freshConv();
  try {
    const dir = getConversationRunAssetDir(convId, 'run_test', 'images');
    assert.ok(dir.includes(`conversations/${convId}/runs/run_test/images`),
      `路径应当包含 conversations/${convId}/runs/run_test/images，实际：${dir}`);
    assert.ok(fs.existsSync(dir), '目录应被建出来');
    console.log('  ✓', path.relative(OUTPUT_ROOT, dir));
  } finally {
    cleanupConversationTmp(convId);
    conversationStore.deleteConversation(convId);
  }
}

function casePromoteAsset() {
  console.log('\n[case 2] saveAssetToSpace 把临时文件 mv 到 promoted/<docId>/');
  const convId = freshConv();
  const space = ensureSpace();
  let savedNode;
  try {
    const tmpDir = getConversationRunAssetDir(convId, 'run_promote', 'images');
    const tmpFile = makeFile(path.join(tmpDir, 'pic.jpg'), 'jpgbytes');
    assert.ok(fs.existsSync(tmpFile), '临时文件应在临时区');

    savedNode = workspaceManager.saveAssetToSpace({
      spaceId: space.id,
      parentId: space.id,
      name: 'smoke pic',
      docType: 'image',
      filePath: tmpFile
    });

    const doc = workspaceManager.getContent(savedNode.id);
    const promotedDir = getPromotedDir(savedNode.id);
    const expectedAbs = path.join(promotedDir, 'pic.jpg');

    assert.ok(!fs.existsSync(tmpFile), '临时文件应已被搬走');
    assert.ok(fs.existsSync(expectedAbs), '应在 promoted/<docId>/ 下找到');
    assert.strictEqual(doc.filePath, expectedAbs, 'doc.filePath 应指向 promoted');
    assert.strictEqual(doc.outputRelativePath, toOutputRelative(expectedAbs));
    assert.strictEqual(doc.downloadUrl, `/api/files/download/${doc.outputRelativePath}`);
    assert.strictEqual(doc.previewUrl, `/output/${doc.outputRelativePath}`);
    console.log('  ✓ promoted →', doc.outputRelativePath);
  } finally {
    if (savedNode) {
      try { workspaceManager.deleteNode(savedNode.id); } catch {}
    }
    cleanupConversationTmp(convId);
    conversationStore.deleteConversation(convId);
  }
}

function caseCleanupKeepsPromoted() {
  console.log('\n[case 3] cleanupConversationTmp 不会误伤 promoted 区');
  const convId = freshConv();
  const space = ensureSpace();
  let savedNode;
  try {
    const tmpDir = getConversationRunAssetDir(convId, 'run_keep', 'exports');
    const tmpFile = makeFile(path.join(tmpDir, 'deck.pptx'), 'pptxbytes');

    savedNode = workspaceManager.saveAssetToSpace({
      spaceId: space.id,
      parentId: space.id,
      name: 'smoke deck',
      docType: 'ppt',
      filePath: tmpFile
    });

    const promotedFile = path.join(getPromotedDir(savedNode.id), 'deck.pptx');
    assert.ok(fs.existsSync(promotedFile), 'promoted 应已经有这个文件');

    // 模拟会话结束、用户删除会话
    cleanupConversationTmp(convId);

    const tmpRoot = path.join(OUTPUT_ROOT, 'conversations', convId);
    assert.ok(!fs.existsSync(tmpRoot), '临时区应被 rm -rf');
    assert.ok(fs.existsSync(promotedFile), 'promoted 文件应仍在');
    console.log('  ✓ tmp 已删，promoted 保留');
  } finally {
    if (savedNode) {
      try { workspaceManager.deleteNode(savedNode.id); } catch {}
    }
    conversationStore.deleteConversation(convId);
  }
}

function caseConflictRename() {
  console.log('\n[case 4] 同名 promote 自动加 (n) 后缀');
  const convId = freshConv();
  try {
    const docId = 'doc_smoke_dup';
    const promoted = getPromotedDir(docId);
    // 预先在 promoted/<docId>/ 占一个 banner.jpg
    fs.writeFileSync(path.join(promoted, 'banner.jpg'), 'EXISTING');

    const tmpDir = getConversationRunAssetDir(convId, 'run_dup', 'images');
    const src = makeFile(path.join(tmpDir, 'banner.jpg'), 'NEW');

    const dest = workspaceManager._promoteFileToDoc(src, docId);
    assert.ok(dest.endsWith('banner (1).jpg'), `应自动加 (1) 后缀，实际：${dest}`);
    assert.ok(!fs.existsSync(src), '源应被搬走');
    assert.strictEqual(fs.readFileSync(path.join(promoted, 'banner.jpg'), 'utf8'), 'EXISTING',
      '原占位文件不应被覆盖');
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'NEW');
    console.log('  ✓', path.relative(OUTPUT_ROOT, dest));
    // 清理 promoted/<docId>/，因为我们用的是手造 docId，不在 workspace 树里
    fs.rmSync(promoted, { recursive: true, force: true });
  } finally {
    cleanupConversationTmp(convId);
    conversationStore.deleteConversation(convId);
  }
}

function caseMissingSrc() {
  console.log('\n[case 5] saveAssetToSpace 收到不存在的源路径时不崩');
  const space = ensureSpace();
  let node;
  try {
    node = workspaceManager.saveAssetToSpace({
      spaceId: space.id,
      parentId: space.id,
      name: 'no source',
      docType: 'file',
      filePath: '/nonexistent/path/foo.bin'
    });
    assert.ok(node && node.id, '应当返回 node');
    const doc = workspaceManager.getContent(node.id);
    // 源不存在 → promoteFileToDoc 直接返回原路径，doc.filePath 保留原绝对路径
    assert.strictEqual(doc.filePath, '/nonexistent/path/foo.bin');
    console.log('  ✓ 缺源不崩；doc.filePath 保留原值');
  } finally {
    if (node) try { workspaceManager.deleteNode(node.id); } catch {}
  }
}

function cleanupTestSpace() {
  const tree = workspaceManager.getTree();
  const stale = (tree.spaces || []).filter((s) => s.name === 'smoke tmp iso 临时空间');
  for (const s of stale) {
    try { workspaceManager.deleteNode(s.id); } catch {}
  }
}

(function main() {
  try {
    caseTmpLayout();
    casePromoteAsset();
    caseCleanupKeepsPromoted();
    caseConflictRename();
    caseMissingSrc();
    console.log('\n✓ 全部 case 通过');
  } finally {
    cleanupTestSpace();
  }
})();
