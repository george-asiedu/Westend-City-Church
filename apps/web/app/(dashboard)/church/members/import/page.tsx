'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Download, FileSpreadsheet } from 'lucide-react';
import type { ImportRowResult } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { Pager } from '@/components/ui/pager';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { canAddMembers, downloadCsv, useClientPage } from '@/lib/membership';

type Row = Record<'fullName' | 'phone' | 'email' | 'gender' | 'dateOfBirth' | 'location' | 'churchRole' | 'constituency' | 'basonta' | 'bacentas' | 'joinedOn', string | null>;
interface Result {
  dryRun: boolean;
  summary: { create: number; duplicate: number; error: number };
  results: ImportRowResult[];
}

/** Column headings we understand (the members CSV export uses the first of each). */
const HEADERS: Record<keyof Row, string[]> = {
  fullName: ['name', 'full name', 'fullname', 'member', 'member name'],
  churchRole: ['role', 'church role', 'position'],
  phone: ['phone', 'phone number', 'mobile', 'telephone', 'contact'],
  email: ['email', 'email address', 'e-mail'],
  gender: ['gender', 'sex'],
  location: ['where they stay', 'location', 'area', 'address', 'residence'],
  constituency: ['constituency'],
  basonta: ['basonta'],
  bacentas: ['bacentas (teams)', 'bacentas', 'bacenta', 'ministry', 'ministries'],
  dateOfBirth: ['date of birth', 'dob', 'birthday', 'birth date'],
  joinedOn: ['joined', 'joined on', 'date joined', 'membership date'],
};
const norm = (h: unknown) => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Minimal RFC 4180 CSV parser (quotes, commas and newlines inside quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell), rows.push(row), (row = []), (cell = '');
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

const cellText = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim() || null;
};

async function readFile(file: File): Promise<{ rows: Row[]; unknown: string[] }> {
  let grid: unknown[][];
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsx } = await import('read-excel-file');
    grid = await readXlsx(file);
  } else if (/\.(csv|txt)$/i.test(file.name)) grid = parseCsv((await file.text()).replace(/^﻿/, ''));
  else throw new Error('Choose an Excel (.xlsx) or CSV file');
  if (grid.length < 2) throw new Error('The file has no rows under the headings');
  const head = grid[0]!.map(norm);
  const col = Object.fromEntries((Object.keys(HEADERS) as Array<keyof Row>).map((k) => [k, head.findIndex((h) => HEADERS[k].includes(h))])) as Record<keyof Row, number>;
  if (col.fullName < 0) throw new Error('No “Name” column. The first row should have the column headings.');
  const known = new Set(Object.values(HEADERS).flat());
  const unknown = grid[0]!.filter((h, i) => cellText(h) && !known.has(head[i]!)).map((h) => String(h));
  const rows = grid.slice(1).map((r) => Object.fromEntries((Object.keys(col) as Array<keyof Row>).map((k) => [k, col[k] >= 0 ? cellText(r[col[k]]) : null])) as Row);
  return { rows: rows.filter((r) => Object.values(r).some(Boolean)), unknown };
}

export default function ImportMembersPage() {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const [file, setFile] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [check, setCheck] = useState<Result | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => api<Result>('/members/import', { method: 'POST', body: { rows, dryRun } }),
    onSuccess: (r) => {
      if (r.dryRun) return setCheck(r);
      toast.success(`Added ${r.summary.create} member${r.summary.create === 1 ? '' : 's'}`);
      void qc.invalidateQueries({ queryKey: ['members'] });
      router.push('/church/members');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const problems = useClientPage(check?.results.filter((r) => r.status !== 'create') ?? []);

  if (me.isLoading) return <PageLoader />;
  if (!me.data || !canAddMembers(me.data)) return <EmptyState title="Only pastors, shepherds and Super Admins can import members" />;

  const onFile = async (f: File | undefined) => {
    setCheck(null);
    if (!f) return;
    try {
      const parsed = await readFile(f);
      if (parsed.rows.length > 2000) throw new Error('Import at most 2,000 rows at a time. Split the file.');
      setFile(f.name);
      setRows(parsed.rows);
      setUnknown(parsed.unknown);
      run.mutate(true);
    } catch (e) {
      setFile(null);
      setRows([]);
      toast.error(errorMessage(e));
    }
  };
  const template = () =>
    downloadCsv('members-template.csv', [
      ['Name', 'Role', 'Phone', 'Email', 'Gender', 'Where they stay', 'Constituency', 'Basonta', 'Bacentas (teams)', 'Date of birth', 'Joined'],
      ['Ama Mensah', 'Member', '0241234567', 'ama@example.com', 'Female', 'Kasoa', '', '', '', '1995-03-14', '2024-01-07'],
    ]);

  return (
    <>
      <Link href="/church/members" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Members
      </Link>
      <PageHeader title="Import members" subtitle="Add many members at once from an Excel sheet or CSV file." />
      <div className="max-w-4xl space-y-4">
        <Card className="space-y-3 p-4">
          <p className="text-sm">
            The first row must be the column headings. Only <b>Name</b> is required. We also read Role, Phone, Email, Gender, Where they stay, Constituency, Basonta, Bacentas (separate several with
            commas), Date of birth and Joined (YYYY-MM-DD or DD/MM/YYYY). Group names must match the app exactly. People whose phone number is already in the directory are skipped.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90">
              <FileSpreadsheet className="h-4 w-4" /> Choose file
              <input type="file" accept=".xlsx,.csv,.txt" className="sr-only" data-testid="import-file" onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
            <Button variant="ghost" onClick={template}>
              <Download className="h-4 w-4" /> Template
            </Button>
            {file && <span className="text-sm text-muted">{file}</span>}
          </div>
          {unknown.length > 0 && <p className="text-xs text-muted">Ignored columns: {unknown.join(', ')}</p>}
        </Card>

        {run.isPending && run.variables && <PageLoader />}
        {check && (
          <Card className="space-y-3 p-4" data-import-check>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-auto font-semibold">Check</h2>
              <Badge tone="success">{check.summary.create} to add</Badge>
              {check.summary.duplicate > 0 && <Badge tone="warning">{check.summary.duplicate} already members</Badge>}
              {check.summary.error > 0 && <Badge tone="danger">{check.summary.error} with problems</Badge>}
            </div>
            {problems.total > 0 && (
              <>
                <Table>
                  <THead>
                    <Tr>
                      <Th numeric>Row</Th>
                      <Th>Name</Th>
                      <Th>Problem</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {problems.items.map((r) => (
                      <Tr key={r.row}>
                        <Td numeric>{r.row}</Td>
                        <Td>{r.fullName}</Td>
                        <Td className={r.status === 'error' ? 'text-danger' : 'text-muted'}>{r.message}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                <Pager list={problems} />
                <p className="text-xs text-muted">Rows with problems are skipped. Fix them in the file and import it again (members already added are skipped as duplicates).</p>
              </>
            )}
            <Button loading={run.isPending && run.variables === false} disabled={!check.summary.create} onClick={() => run.mutate(false)}>
              Add {check.summary.create} member{check.summary.create === 1 ? '' : 's'}
            </Button>
          </Card>
        )}
      </div>
    </>
  );
}
