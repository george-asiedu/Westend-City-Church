'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { eventFormSchema, PROGRAM_TYPE_SUGGESTIONS, defaultEventTitle, type CategoryDto, type EventDto, type EventFormInput } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import { todayIso } from '@/lib/utils';

/** Create or edit an event (date sub-folder). */
export function EventFormDialog({
  open,
  onOpenChange,
  categories,
  event,
  defaultCategoryId,
  defaultDate,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  categories: CategoryDto[];
  event?: EventDto;
  defaultCategoryId?: string;
  defaultDate?: string;
  onSaved?: (e: EventDto) => void;
}) {
  const qc = useQueryClient();
  const form = useForm<EventFormInput>({ resolver: zodResolver(eventFormSchema) });
  const { register, handleSubmit, watch, reset, formState } = form;

  useEffect(() => {
    if (!open) return;
    reset(
      event
        ? {
            categoryId: event.categoryId,
            eventDate: event.eventDate,
            endDate: event.endDate ?? '',
            title: event.title,
            programType: event.programType ?? '',
            location: event.location ?? '',
            description: event.description ?? '',
            status: event.status,
          }
        : { categoryId: defaultCategoryId ?? categories[0]?.id ?? '', eventDate: defaultDate ?? todayIso(), endDate: '', title: '', status: 'PUBLISHED' },
    );
  }, [open, event, defaultCategoryId, defaultDate, categories, reset]);

  const categoryId = watch('categoryId');
  const eventDate = watch('eventDate');
  const category = categories.find((c) => c.id === categoryId);

  const save = useMutation({
    mutationFn: (v: EventFormInput) => {
      const body = { ...v, endDate: category?.allowsMultiDay ? v.endDate || null : null, title: v.title?.trim() || undefined };
      return event ? api<EventDto>(`/events/${event.id}`, { method: 'PATCH', body }) : api<EventDto>('/events', { method: 'POST', body });
    },
    onSuccess: (e) => {
      toast.success(event ? 'Event updated' : 'Event created');
      void qc.invalidateQueries({ queryKey: ['events'] });
      void qc.invalidateQueries({ queryKey: ['timeline'] });
      void qc.invalidateQueries({ queryKey: ['categories'] });
      qc.setQueryData(['event', e.id], e);
      onOpenChange(false);
      onSaved?.(e);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={event ? 'Edit event' : 'New event'}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>
            {event ? 'Save' : 'Create event'}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit((v) => save.mutate(v))}>
        <Field label="Folder" htmlFor="categoryId" error={formState.errors.categoryId?.message}>
          <Select id="categoryId" {...register('categoryId')}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={category?.allowsMultiDay ? 'Start date' : 'Date'} htmlFor="eventDate" error={formState.errors.eventDate?.message}>
            <Input id="eventDate" type="date" {...register('eventDate')} />
          </Field>
          {category?.allowsMultiDay && (
            <Field label="End date (optional)" htmlFor="endDate" error={formState.errors.endDate?.message}>
              <Input id="endDate" type="date" {...register('endDate')} />
            </Field>
          )}
        </div>
        <Field label="Title" htmlFor="title" hint={category && eventDate ? `Leave empty for “${defaultEventTitle(category.name, eventDate)}”` : undefined}>
          <Input id="title" maxLength={160} {...register('title')} />
        </Field>
        {category?.allowsMultiDay && (
          <Field label="Program type" htmlFor="programType" hint="e.g. Outreach, Christening, Funeral">
            <Input id="programType" list="program-types" maxLength={60} {...register('programType')} />
            <datalist id="program-types">
              {PROGRAM_TYPE_SUGGESTIONS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>
        )}
        <Field label="Location (optional)" htmlFor="location">
          <Input id="location" maxLength={160} {...register('location')} />
        </Field>
        <Field label="Description (optional)" htmlFor="description">
          <Textarea id="description" maxLength={5000} {...register('description')} />
        </Field>
        <Field label="Visibility" htmlFor="status" hint="Drafts are visible only to you, folder managers and admins.">
          <Select id="status" {...register('status')}>
            <option value="PUBLISHED">Published</option>
            <option value="DRAFT">Draft (still uploading)</option>
          </Select>
        </Field>
      </form>
    </Dialog>
  );
}
