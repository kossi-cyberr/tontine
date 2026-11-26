import { apiFetch } from './api';

export interface AppNotification {
  id: string;
  template: string;
  title: string;
  message: string;
  read: boolean;
  status: string;
  created_at: string;
}

export const notificationsApi = {
  list: (page = 1) => apiFetch<AppNotification[]>(`/me/notifications?page=${page}`),
  count: () => apiFetch<{ unread: number }>('/me/notifications/count'),
  read: (id: string) =>
    apiFetch<{ read: boolean }>(`/me/notifications/${id}/read`, { method: 'POST' }),
  readAll: () => apiFetch<{ updated: number }>('/me/notifications/read-all', { method: 'POST' }),
};
