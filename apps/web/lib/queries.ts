'use client';

import { useQuery } from '@tanstack/react-query';
import type { CategoryDto, EventDto, MeResponse } from '@wcc/shared';
import { api } from './api';

export const qk = {
  me: ['me'] as const,
  categories: ['categories'] as const,
  category: (slug: string) => ['category', slug] as const,
  timeline: (slug: string) => ['timeline', slug] as const,
  events: (params: Record<string, unknown>) => ['events', params] as const,
  event: (id: string) => ['event', id] as const,
  media: (eventId: string, params: Record<string, unknown>) => ['media', eventId, params] as const,
  mediaItem: (id: string) => ['mediaItem', id] as const,
  search: (params: Record<string, unknown>) => ['search', params] as const,
  trash: ['trash'] as const,
  users: (params: Record<string, unknown>) => ['users', params] as const,
  invitations: ['invitations'] as const,
  audit: (params: Record<string, unknown>) => ['audit', params] as const,
  sessions: ['sessions'] as const,
  shares: (eventId?: string) => ['shares', eventId ?? 'all'] as const,
  exports: ['exports'] as const,
  storage: ['storage'] as const,
  tags: (q: string) => ['tags', q] as const,
};

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => api<MeResponse>('/auth/me'), staleTime: 60_000 });
export const useCategories = () => useQuery({ queryKey: qk.categories, queryFn: () => api<CategoryDto[]>('/categories'), staleTime: 60_000 });
export const useEvent = (id: string) => useQuery({ queryKey: qk.event(id), queryFn: () => api<EventDto>(`/events/${id}`) });

export interface CategoryDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  allowsMultiDay: boolean;
  isActive: boolean;
  canUpload: boolean;
  canManage: boolean;
}
