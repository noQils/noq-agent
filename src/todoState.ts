export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  status: TodoStatus;
  content: string;
}

const todoStatuses = new Set<TodoStatus>(['pending', 'in_progress', 'completed']);

let todoItems: TodoItem[] = [];

export function isTodoStatus(value: string): value is TodoStatus {
  return todoStatuses.has(value as TodoStatus);
}

export function resetTodoState(): void {
  todoItems = [];
}

export function replaceTodoItems(items: TodoItem[]): void {
  todoItems = items.map((item) => ({
    status: item.status,
    content: item.content,
  }));
}

export function getTodoItems(): TodoItem[] {
  return todoItems.map((item) => ({
    status: item.status,
    content: item.content,
  }));
}

export function hasTodoItems(): boolean {
  return todoItems.length > 0;
}

export function hasUnfinishedTodoItems(): boolean {
  return todoItems.some((item) => item.status !== 'completed');
}

function buildTodoSummary(items: TodoItem[]): string {
  const counts = {
    pending: 0,
    in_progress: 0,
    completed: 0,
  };

  for (const item of items) {
    counts[item.status]++;
  }

  return `Summary: ${items.length} total, ${counts.pending} pending, ${counts.in_progress} in progress, ${counts.completed} completed.`;
}

export function formatTodoItems(items: TodoItem[] = todoItems): string {
  if (items.length === 0) {
    return 'No todo items are currently tracked for this turn.';
  }

  const lines = items.map((item, index) => `${index + 1}. [${item.status}] ${item.content}`);

  return `Current todo list:\n${lines.join('\n')}\n${buildTodoSummary(items)}`;
}
