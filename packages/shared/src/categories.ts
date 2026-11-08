export interface CategorySeed {
  sortOrder: number;
  slug: string;
  name: string;
  allowsMultiDay: boolean;
}

/**
 * The fixed category (main folder) list. Seeded in this order; renamable by a
 * SUPER_ADMIN afterwards, never hard-deleted. Bacenta and Regional services
 * sit with the other services, before the kids' church and programs.
 */
export const CATEGORY_SEED: readonly CategorySeed[] = [
  { sortOrder: 1, slug: 'sunday-1st-service', name: 'Sunday 1st Service', allowsMultiDay: false },
  { sortOrder: 2, slug: 'sunday-2nd-service', name: 'Sunday 2nd Service', allowsMultiDay: false },
  { sortOrder: 3, slug: 'impartation-service', name: 'Impartation Service', allowsMultiDay: false },
  { sortOrder: 4, slug: 'turning-point-service', name: 'Turning Point Service', allowsMultiDay: false },
  { sortOrder: 5, slug: 'y-element-service', name: 'The Y Element Service', allowsMultiDay: false },
  { sortOrder: 6, slug: 'bacenta-service', name: 'Bacenta Service', allowsMultiDay: false },
  { sortOrder: 7, slug: 'regional-service', name: 'Regional Service', allowsMultiDay: false },
  { sortOrder: 8, slug: 'save-church-kids', name: 'The Save Church (Kids)', allowsMultiDay: false },
  { sortOrder: 9, slug: 'other-church-programs', name: 'Other Church Programs', allowsMultiDay: true },
  { sortOrder: 10, slug: 'camps', name: 'Camps', allowsMultiDay: true },
  { sortOrder: 11, slug: 'conferences', name: 'Conferences', allowsMultiDay: true },
];

export const PROGRAM_TYPE_SUGGESTIONS = [
  'Outreach',
  'Christening',
  'Funeral',
  'Wedding',
  'Swollen Sunday',
  'Baptism',
  'Dedication',
] as const;
