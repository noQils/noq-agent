import {
  formatTodoItems,
  isTodoStatus,
  replaceTodoItems,
  type TodoItem,
} from '../todoState';
import { type InternalTool } from './index';

const todoLinePattern = /^\s*(?:[-*]\s*)?\[(pending|in_progress|completed)\]\s+(.+?)\s*$/;
const maxTodoItems = 20;

function parseTodoItems(rawTodos: string): TodoItem[] {
  const trimmedTodos = rawTodos.trim();
  if (trimmedTodos.length === 0) {
    return [];
  }

  const lines = trimmedTodos
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > maxTodoItems) {
    throw new Error(`Too many todo items. Keep the list to ${maxTodoItems} items or fewer.`);
  }

  return lines.map((line, index) => {
    const match = line.match(todoLinePattern);
    if (!match) {
      throw new Error(
        `Invalid todo line ${index + 1}. Use the format "[pending] Task", "[in_progress] Task", or "[completed] Task".`
      );
    }

    const rawStatus = match[1];
    const rawContent = match[2];
    if (typeof rawStatus !== 'string' || !isTodoStatus(rawStatus)) {
      throw new Error(`Invalid todo status on line ${index + 1}: ${rawStatus}`);
    }

    if (typeof rawContent !== 'string') {
      throw new Error(`Missing todo content on line ${index + 1}.`);
    }

    return {
      status: rawStatus,
      content: rawContent.trim(),
    };
  });
}

export const todoWriteTool: InternalTool = {
  name: 'todo_write',
  description: 'Replace the current todo list for this turn. Provide the full updated list with one item per line in the format "[pending] Task", "[in_progress] Task", or "[completed] Task". Pass an empty string to clear the list when the work is done.',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'string',
        description: 'The full updated todo list. Example: "[pending] Inspect workflow\\n[in_progress] Add todo tool\\n[completed] Verify build". Pass an empty string to clear the list.',
        required: true,
      },
    },
    additionalProperties: false,
  },
  allowedModes: ['plan', 'build'],
  permission: {
    scope: 'todo',
    getTarget: () => 'session_todo_list',
  },
  execute: (args: { todos: string }) => {
    if (typeof args.todos !== 'string') {
      throw new Error('todos must be a string.');
    }

    const items = parseTodoItems(args.todos);
    replaceTodoItems(items);

    if (items.length === 0) {
      return 'Todo list cleared.';
    }

    return `Todo list updated.\n${formatTodoItems(items)}\nAlways send the full updated list on the next todo_write call.`;
  },
};
