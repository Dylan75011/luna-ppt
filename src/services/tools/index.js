// 工具注册表入口：汇总定义 + 执行路由 + 展示名称
const { TOOL_DEFINITIONS } = require('./definitions');
const { getToolDisplay } = require('./helpers');
const { execWriteTodos, execUpdateBrief } = require('./briefTools');
const { execGenerateImage, execSearchImages, execReviewUploadedImages } = require('./imageTools');
const { execWebSearch, execWebFetch } = require('./researchTools');
const { execBrowserSearch, execBrowserReadPage, execBrowserReadNotes, execAnalyzeNoteImages } = require('./browserTools');
const {
  execReadWorkspaceDoc,
  execSaveToWorkspace,
  execUpdateWorkspaceDoc,
  execPatchWorkspaceDocSection,
  execFindReplaceInDoc,
  execAppendWorkspaceDoc,
  execListWorkspaceDocs,
  execSearchWorkspaceDocs,
  execCreateWorkspaceFolder,
  execRenameWorkspaceDoc,
  execSetWorkspaceDocRole,
  execDeleteWorkspaceDoc
} = require('./workspaceTools');
const { execRunStrategy, execReviewStrategy } = require('./strategyTools');
const { execProposeConcept, execApproveConcept } = require('./conceptTools');
const { execChallengeBrief } = require('./challengeTools');
const { execBuildPpt } = require('./pptTools');

const TOOL_EXECUTORS = {
  write_todos:            execWriteTodos,
  update_brief:           execUpdateBrief,
  generate_image:         execGenerateImage,
  search_images:          execSearchImages,
  review_uploaded_images: execReviewUploadedImages,
  web_search:             execWebSearch,
  web_fetch:              execWebFetch,
  browser_search:         execBrowserSearch,
  browser_read_page:      execBrowserReadPage,
  browser_read_notes:     execBrowserReadNotes,
  analyze_note_images:    execAnalyzeNoteImages,
  challenge_brief:        execChallengeBrief,
  propose_concept:        execProposeConcept,
  approve_concept:        execApproveConcept,
  run_strategy:           execRunStrategy,
  review_strategy:        execReviewStrategy,
  build_ppt:              execBuildPpt,
  read_workspace_doc:          execReadWorkspaceDoc,
  save_to_workspace:           execSaveToWorkspace,
  update_workspace_doc:        execUpdateWorkspaceDoc,
  patch_workspace_doc_section: execPatchWorkspaceDocSection,
  find_replace_in_doc:         execFindReplaceInDoc,
  append_workspace_doc:        execAppendWorkspaceDoc,
  list_workspace_docs:      execListWorkspaceDocs,
  search_workspace_docs:    execSearchWorkspaceDocs,
  create_workspace_folder:  execCreateWorkspaceFolder,
  rename_workspace_doc:     execRenameWorkspaceDoc,
  set_workspace_doc_role:   execSetWorkspaceDocRole,
  delete_workspace_doc:     execDeleteWorkspaceDoc
};

async function executeTool(toolName, args, session, onEvent) {
  const executor = TOOL_EXECUTORS[toolName];
  if (!executor) throw new Error(`未知工具：${toolName}`);
  return executor(args, session, onEvent);
}

module.exports = { TOOL_DEFINITIONS, executeTool, getToolDisplay };
