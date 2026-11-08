import { z } from 'zod';
import { ROLES } from './enums';

export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(200, 'That password is too long');

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  totp: z
    .string()
    .regex(/^(\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/, 'Enter the 6-digit code or a recovery code')
    .optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const eventFormSchema = z
  .object({
    categoryId: z.string().uuid(),
    eventDate: isoDate,
    endDate: isoDate.optional().or(z.literal('')),
    title: z.string().max(160).optional(),
    programType: z.string().max(60).optional(),
    location: z.string().max(160).optional(),
    description: z.string().max(5000).optional(),
    status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.eventDate, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });
export type EventFormInput = z.infer<typeof eventFormSchema>;

export const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(ROLES as [string, ...string[]]),
  categoryIds: z.array(z.string().uuid()).default([]),
});

export const shareLinkSchema = z.object({
  eventId: z.string().uuid().optional(),
  mediaIds: z.array(z.string().uuid()).max(500).optional(),
  title: z.string().max(160).optional(),
  expiresInHours: z.number().int().min(1).max(24 * 90),
  password: z.string().min(6).max(200).optional().or(z.literal('')),
  allowDownload: z.boolean(),
});
export type ShareLinkInput = z.infer<typeof shareLinkSchema>;
