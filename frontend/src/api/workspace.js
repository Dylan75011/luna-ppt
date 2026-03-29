const BASE = '/api/workspace'

async function req(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(BASE + path, opts)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export const workspaceApi = {
  getTree:        ()                        => req('GET',    ''),
  createSpace:    (name)                    => req('POST',   '/space',           { name }),
  createFolder:   (parentId, name)          => req('POST',   '/folder',          { parentId, name }),
  createDocument: (parentId, name, docType) => req('POST',   '/document',        { parentId, name, docType }),
  listConversations: (spaceId)              => req('GET',    `/${spaceId}/conversations`),
  createConversation: (spaceId, title)      => req('POST',   `/${spaceId}/conversations`, { title }),
  getConversation:  (id)                    => req('GET',    `/conversations/${id}`),
  saveConversation: (id, payload)           => req('PUT',    `/conversations/${id}`, payload),
  removeConversation: (id)                  => req('DELETE', `/conversations/${id}`),
  rename:         (id, name)                => req('PUT',    `/${id}/rename`,    { name }),
  remove:         (id)                      => req('DELETE', `/${id}`),
  getContent:     (id)                      => req('GET',    `/${id}/content`),
  saveContent:    (id, content, contentFormat = 'tiptap-json') => req('PUT', `/${id}/content`, { content, contentFormat }),
  savePpt:        (payload)                 => req('POST',   '/save-ppt',        payload),

  // Word 导入：上传 .docx 文件，返回 { html }
  importWord(nodeId, file) {
    const form = new FormData()
    form.append('file', file)
    return fetch(`${BASE}/${nodeId}/import-word`, { method: 'POST', body: form })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
  },

  // Word 导出：直接返回下载 URL（浏览器打开即下载）
  exportWordUrl(nodeId) {
    return `${BASE}/${nodeId}/export-word`
  }
}
