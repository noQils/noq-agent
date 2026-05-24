import { formatTodoItems } from '../todoState';
import { type InternalTool } from './index';

export const todoReadTool: InternalTool = {
  name: 'todo_read',
  description: 'Read the current todo list for this turn. Use this when you need to check the tracked steps before continuing.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  allowedModes: ['plan', 'build'],
  permission: {
    scope: 'todo',
    getTarget: () => 'session_todo_list',
  },
  execute: () => formatTodoItems(),
};
