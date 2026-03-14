import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { SystemMessage } from '@langchain/core/messages';
import { createModel } from './model.js';
import { createJobTool, getJobStatusTool, getSystemTechnicalSpecsTool, getSkillBuildingGuideTool, getSkillDetailsTool, createStartHeadlessCodingTool, createGetRepositoryDetailsTool } from './tools.js';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { jobPlanningMd, codePlanningMd, codeExecutionMd, thepopebotDb } from '../paths.js';
import { render_md } from '../utils/render-md.js';
import { createWebSearchTool, getProvider } from './web-search.js';

let _agent = null;

/**
 * Get or create the LangGraph job agent singleton.
 * Uses createReactAgent which handles the tool loop automatically.
 * Prompt is a function so {{datetime}} resolves fresh each invocation.
 */
export async function getJobAgent() {
  if (!_agent) {
    const model = await createModel();
    const tools = [createJobTool, getJobStatusTool, getSystemTechnicalSpecsTool, getSkillBuildingGuideTool, getSkillDetailsTool];

    const webSearchTool = await createWebSearchTool();
    if (webSearchTool) {
      tools.push(webSearchTool);
      console.log(`[agent] Web search enabled (provider: ${getProvider()})`);
    }

    const checkpointer = SqliteSaver.fromConnString(thepopebotDb);

    _agent = createReactAgent({
      llm: model,
      tools,
      checkpointSaver: checkpointer,
      prompt: (state) => [new SystemMessage(render_md(jobPlanningMd)), ...state.messages],
    });
  }
  return _agent;
}

/**
 * Reset the agent singleton (e.g., when config changes).
 */
export function resetAgent() {
  _agent = null;
}

const _codeAgents = new Map();

/**
 * Get or create a code agent for a specific chat/workspace.
 * Each code chat gets its own agent with unique start_coding tool bindings.
 * Agents are keyed by chatId+mode so switching modes creates a new agent with the right prompt.
 * @param {object} context
 * @param {string} context.repo - GitHub repo
 * @param {string} context.branch - Git branch
 * @param {string} context.workspaceId - Pre-created workspace row ID
 * @param {string} context.chatId - Chat thread ID
 * @param {string} [context.codeModeType='plan'] - 'plan' or 'code'
 * @returns {Promise<object>} LangGraph agent
 */
export async function getCodeAgent({ repo, branch, workspaceId, chatId, codeModeType = 'plan' }) {
  const cacheKey = `${chatId}:${codeModeType}`;
  if (_codeAgents.has(cacheKey)) {
    return _codeAgents.get(cacheKey);
  }

  const model = await createModel();
  const startHeadlessCodingTool = createStartHeadlessCodingTool({ repo, branch, workspaceId });
  const getRepoDetailsTool = createGetRepositoryDetailsTool({ repo, branch });

  const tools = [startHeadlessCodingTool, getRepoDetailsTool];

  const webSearchTool = await createWebSearchTool();
  if (webSearchTool) {
    tools.push(webSearchTool);
    console.log(`[agent] Web search enabled for code agent (provider: ${getProvider()})`);
  }

  const checkpointer = SqliteSaver.fromConnString(thepopebotDb);

  const promptMd = codeModeType === 'code' ? codeExecutionMd : codePlanningMd;

  const agent = createReactAgent({
    llm: model,
    tools,
    checkpointSaver: checkpointer,
    prompt: (state) => [new SystemMessage(render_md(promptMd)), ...state.messages],
  });

  _codeAgents.set(cacheKey, agent);
  return agent;
}
