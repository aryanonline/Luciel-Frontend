import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from './test-utils';
import { KnowledgePillar } from '@/components/config/knowledge-pillar';

/**
 * The CSV import feeds BOTH stores (live-caught 2026-08-17).
 *
 * The tools pillar tells owners the lookup_record CSV "lives under Knowledge" —
 * but the Knowledge CSV import only ingested knowledge text; the record-source
 * upload route had NO frontend caller, so the lookup tool could never be wired
 * through the UI at all. Pinned here: one CSV import calls BOTH the knowledge
 * ingest AND the record-source upload, says the row count out loud, and a
 * record-source failure is reported honestly rather than silently downgraded
 * to knowledge-only success.
 */

const importCsv = vi.fn();
const uploadRecordSourceCsv = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      knowledge: {
        ...actual.api.knowledge,
        importCsv: (...args: unknown[]) => Promise.resolve(importCsv(...args)),
      },
      connections: {
        ...actual.api.connections,
        uploadRecordSourceCsv: (...args: unknown[]) =>
          Promise.resolve(uploadRecordSourceCsv(...args)),
      },
    },
  };
});

function importAFile() {
  const csvInput = document.querySelector('input[type=file][accept=".csv"]') as HTMLInputElement;
  const file = new File(['order_id,item\n1042,Glaze kit\n1043,Bat set\n'], 'orders.csv', {
    type: 'text/csv',
  });
  fireEvent.change(csvInput, { target: { files: [file] } });
}

beforeEach(() => {
  importCsv.mockReset().mockResolvedValue({});
  uploadRecordSourceCsv.mockReset().mockResolvedValue({
    records: 2,
    columns: ['order_id', 'item'],
  });
});

describe('one CSV import wires knowledge AND the live-lookup table', () => {
  it('calls both stores and says the row count out loud', async () => {
    renderWithQuery(<KnowledgePillar />);
    await screen.findByRole('button', { name: /Import CSV/i });
    importAFile();

    await waitFor(() => expect(uploadRecordSourceCsv).toHaveBeenCalledTimes(1));
    expect(importCsv).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/2 rows are also on file for live record lookups/i),
    ).toBeInTheDocument();
  });

  it('reports a record-source failure honestly instead of claiming full success', async () => {
    uploadRecordSourceCsv.mockRejectedValue(new Error('route down'));
    renderWithQuery(<KnowledgePillar />);
    await screen.findByRole('button', { name: /Import CSV/i });
    importAFile();

    expect(
      await screen.findByText(/live-lookup table could not be updated/i),
    ).toBeInTheDocument();
    expect(importCsv).toHaveBeenCalledTimes(1);  // the knowledge half still landed
  });
});
