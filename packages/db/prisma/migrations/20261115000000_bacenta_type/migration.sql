-- Own migration: a new enum value can't be used in the transaction that adds it.
ALTER TYPE "GroupType" ADD VALUE IF NOT EXISTS 'BACENTA';
