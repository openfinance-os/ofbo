// Tests for control ids on records (2.1.0, plan row 3.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { controlsForRecord, loadObligations } from './record-controls.mjs';
import { buildEnvelope } from './provenance.mjs';

const REG = { finos_catalogue: { ref: 'finos-ai-governance@2026-06' }, obligations: [
  { id: 'OB-1', control_ids: ['CTRL-001', 'CTRL-002'], catalog_controls: ['HG-0003', 'Q4-SUPPLY'], finos: ['mi-4'] },
  { id: 'OB-2', control_ids: ['CTRL-009'], catalog_controls: ['PA-GATES'], finos: ['mi-20', 'ri-3'] },
  { id: 'OB-3', control_ids: [], catalog_controls: ['HG-0003'], finos: ['mi-4'] },
] };

test('the controls block names every obligation citing the record\'s catalog controls, their CTRL ids and FINOS ids, deduped and sorted, with the source logged', () => {
  const loaded = { doc: REG, obligations: REG.obligations, byId: new Map(REG.obligations.map((o) => [o.id, o])) };
  assert.deepEqual(controlsForRecord(loaded, ['HG-0003']), { institution: ['CTRL-001', 'CTRL-002', 'OB-1', 'OB-3'], finos: ['mi-4'], catalog: ['HG-0003'], controls_source: 'obligations:finos-ai-governance@2026-06' });
  assert.deepEqual(controlsForRecord(loaded, ['PA-GATES', 'Q4-SUPPLY', 'Q4-SUPPLY']).institution, ['CTRL-001', 'CTRL-002', 'CTRL-009', 'OB-1', 'OB-2']);
  assert.deepEqual(controlsForRecord(loaded, ['NOTHING']), { institution: [], finos: [], catalog: ['NOTHING'], controls_source: 'obligations:finos-ai-governance@2026-06' });
});

test('no register: empty lists and controls_source "none" — said on the envelope, never omitted', () => {
  assert.deepEqual(controlsForRecord(null, ['HG-0003']), { institution: [], finos: [], catalog: ['HG-0003'], controls_source: 'none' });
  const e = buildEnvelope({ kind: 'gate', name: 'g', subject: { flow: 'delivery', trail: 'T' }, commit: 'a'.repeat(40), actor: { id: 'x' }, controls: controlsForRecord(null, ['A']) });
  assert.equal(e.controls.controls_source, 'none');
  assert.equal(buildEnvelope({ kind: 'gate', name: 'g', subject: { flow: 'delivery', trail: 'T' }, commit: 'a'.repeat(40), actor: { id: 'x' } }).controls, null);
});

test('loadObligations reads the mounted register and returns null without one', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'oblig-'));
  try {
    assert.equal(loadObligations(cwd), null);
    mkdirSync(join(cwd, 'docs/governance'), { recursive: true });
    writeFileSync(join(cwd, 'docs/governance/obligations.json'), JSON.stringify(REG));
    const l = loadObligations(cwd);
    assert.equal(l.obligations.length, 3); assert.ok(l.byId.has('OB-2'));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
