// Mock-driver rows for the Reminders app.
// Live mode never reads this file — the Hub spreadsheet `reminders` tab is the truth.
export type Reminder = {
  id: string
  title: string
  description: string
  dueDate: string
  priority: 'high' | 'medium' | 'low'
  tags: string
  assignee: string
  status: 'open' | 'done'
  createdBy: string
  createdAt: string
}

export const reminders: Reminder[] = []
