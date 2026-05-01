// 验证 output 存储优化：
//   1) saveConversationSnapshot 的 upsert 路径（同 id 覆盖、新 id 追加、消失 id 删除）
//   2) shrink sanity check 拒绝把消息从 N 条砍到 0 条 / 砍掉 ≥50 条
//   3) safeJson 损坏感知：人工写入坏 JSON 到 agent_state_json，再读，应该
//      在 data/corrupted/ 留一份备份，且不抛错
//   4) workspaceManager.writeJsonAtomic 注入 schemaVersion；读出 doc 应带版本号
//
// 用法：node scripts/smoke-output-storage.js
// 不启 HTTP server，直接调模块。每个 case 用独立 id 不污染已有数据。

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));

const conversationStore = require('../src/services/conversationStore');
const workspaceManager = require('../src/services/workspaceManager');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.resolve('./data');
const DB_FILE = path.join(DATA_DIR, 'platform.sqlite');
const CORRUPT_DIR = path.join(DATA_DIR, 'corrupted');
const DOCS_DIR = path.join(DATA_DIR, 'docs');

function freshConv(workspaceId = 'space_smoke_output_storage') {
  return conversationStore.createConversation(workspaceId, 'smoke output storage').id;
}
function cleanupConv(id) { try { conversationStore.deleteConversation(id); } catch {} }

function caseUpsertPath() {
  console.log('\n[case 1] upsert 路径：覆盖、追加、删除');
  const convId = freshConv();
  try {
    // 写入 3 条
    conversationStore.saveConversationSnapshot(convId, {
      title: 't1',
      messages: [
        { id: 'm1', role: 'user', text: 'hello' },
        { id: 'm2', role: 'assistant', text: 'world' },
        { id: 'm3', role: 'user', text: 'three' }
      ]
    });
    let detail = conversationStore.getConversationDetail(convId);
    assert.strictEqual(detail.messages.length, 3, 'should have 3 messages');
    assert.strictEqual(detail.messages[1].text, 'world');

    // 修改 m2，删除 m3，新增 m4 —— upsert 应只动这三行
    conversationStore.saveConversationSnapshot(convId, {
      title: 't1',
      messages: [
        { id: 'm1', role: 'user', text: 'hello' },
        { id: 'm2', role: 'assistant', text: 'WORLD-EDITED' },
        { id: 'm4', role: 'user', text: 'four' }
      ]
    });
    detail = conversationStore.getConversationDetail(convId);
    assert.strictEqual(detail.messages.length, 3, 'still 3 after edit');
    const byId = Object.fromEntries(detail.messages.map((m) => [m.id, m]));
    assert.strictEqual(byId.m1.text, 'hello');
    assert.strictEqual(byId.m2.text, 'WORLD-EDITED');
    assert.strictEqual(byId.m4.text, 'four');
    assert.ok(!byId.m3, 'm3 should be removed');
    console.log('  ✓ upsert + 删除多余 id 工作正常');
  } finally {
    cleanupConv(convId);
  }
}

function caseShrinkGuard() {
  console.log('\n[case 2] shrink sanity check：拒绝空快照覆盖已有历史');
  const convId = freshConv();
  try {
    // 灌入 60 条
    const big = [];
    for (let i = 0; i < 60; i++) big.push({ id: `b${i}`, role: 'user', text: `m${i}` });
    conversationStore.saveConversationSnapshot(convId, { messages: big });
    let detail = conversationStore.getConversationDetail(convId);
    assert.strictEqual(detail.messages.length, 60);

    // 试图传空数组 —— 必须拒
    let threw = false;
    try {
      conversationStore.saveConversationSnapshot(convId, { messages: [] });
    } catch (e) {
      threw = true;
      assert.strictEqual(e.code, 'SUSPICIOUS_SNAPSHOT_SHRINK');
    }
    assert.ok(threw, '空数组应被拒');
    detail = conversationStore.getConversationDetail(convId);
    assert.strictEqual(detail.messages.length, 60, '历史不应被抹掉');

    // 砍到只剩 5 条 —— shrink=55 ≥ 50，也必须拒
    threw = false;
    try {
      conversationStore.saveConversationSnapshot(convId, {
        messages: big.slice(0, 5)
      });
    } catch (e) {
      threw = true;
    }
    assert.ok(threw, '剧烈缩水应被拒');
    detail = conversationStore.getConversationDetail(convId);
    assert.strictEqual(detail.messages.length, 60, '历史不应被抹掉');

    // 正常缩水 1 条（用户主动删了一条）—— 不应拒
    conversationStore.saveConversationSnapshot(convId, {
      messages: big.slice(0, 59)
    });
    detail = conversationStore.getConversationDetail(convId);
    assert.strictEqual(detail.messages.length, 59);
    console.log('  ✓ 缩水阈值守卫与正常编辑均工作');
  } finally {
    cleanupConv(convId);
  }
}

function caseCorruptionBackup() {
  console.log('\n[case 3] safeJson 损坏感知：坏 JSON 写一份备份');
  const convId = freshConv();
  // 直接 SQL 注入坏 JSON 到 agent_state_json 列
  const db = new DatabaseSync(DB_FILE);
  try {
    db.prepare(`UPDATE conversations SET agent_state_json = ? WHERE id = ?`).run(
      '{this is not valid json',
      convId
    );

    const before = fs.existsSync(CORRUPT_DIR)
      ? fs.readdirSync(CORRUPT_DIR).length
      : 0;

    // 读取应该不抛、返回 fallback
    const state = conversationStore.getAgentState(convId);
    assert.deepStrictEqual(state, {}, 'fallback 应为 {}');

    assert.ok(fs.existsSync(CORRUPT_DIR), 'data/corrupted/ 应被创建');
    const after = fs.readdirSync(CORRUPT_DIR).length;
    assert.ok(after > before, '应至少多出一个备份文件');
    const newest = fs.readdirSync(CORRUPT_DIR)
      .map((name) => ({ name, mtime: fs.statSync(path.join(CORRUPT_DIR, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0];
    const dumped = fs.readFileSync(path.join(CORRUPT_DIR, newest.name), 'utf8');
    assert.strictEqual(dumped, '{this is not valid json', '备份内容应原样保留');
    console.log(`  ✓ 损坏内容已备份到 ${newest.name}`);
  } finally {
    db.close();
    cleanupConv(convId);
  }
}

function caseDocSchemaVersion() {
  console.log('\n[case 4] doc JSON 自动注入 schemaVersion');
  // 找一个已有 space 写一个 doc，避免改动 workspaces 树太多
  const tree = workspaceManager.getTree();
  let space = (tree.spaces || []).find((s) => s.type === 'space');
  if (!space) {
    space = workspaceManager.createSpace('smoke output storage 临时空间');
  }
  const node = workspaceManager.createNode({
    parentId: space.id,
    name: '__smoke_schema_version__',
    type: 'document',
    docType: 'document'
  });
  try {
    const file = path.join(DOCS_DIR, node.id + '.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(raw.schemaVersion, 1, '新建 doc 应带 schemaVersion=1');

    // 编辑后再读一次
    workspaceManager.saveContent(node.id, { type: 'doc', content: [{ type: 'paragraph' }] });
    const raw2 = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(raw2.schemaVersion, 1, 'saveContent 后仍应带 schemaVersion=1');
    console.log('  ✓ 新建/编辑路径都注入了 schemaVersion');
  } finally {
    try { workspaceManager.deleteNode(node.id); } catch {}
  }
}

(function main() {
  caseUpsertPath();
  caseShrinkGuard();
  caseCorruptionBackup();
  caseDocSchemaVersion();
  console.log('\n✓ 全部 case 通过');
})();
