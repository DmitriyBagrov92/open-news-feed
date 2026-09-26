import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installClientShims } from '../../helpers/client-shims.js';

installClientShims();
const { stanceOf, contrastRows } = await import('../../../public/js/battle-brief.js');

const art = (lean, source, title) => ({ lean, source: { id: source.toLowerCase(), name: source }, title });

test('stanceOf scores hostile vs approving headlines and keeps the most polarized as evidence', () => {
  assert.deepEqual(stanceOf([{ title: 'Senate slams the tariff plan' }]), { score: -1, evidence: 'Senate slams the tariff plan' });
  assert.deepEqual(stanceOf([{ title: 'Governor wins the recall vote' }]), { score: 1, evidence: 'Governor wins the recall vote' });
  // both lexicons in one headline cancel out: no evidence
  assert.deepEqual(stanceOf([{ title: 'Leader slams critics, wins vote' }]), { score: 0, evidence: null });
  // word boundaries: "Slamdance" and "winsome" are not verdicts
  assert.deepEqual(stanceOf([{ title: 'Slamdance festival opens' }, { title: 'A winsome debut' }]), { score: 0, evidence: null });
  // the later headline of equal polarity is the evidence (>=)
  assert.equal(stanceOf([{ title: 'Critics warn of chaos' }, { title: 'Allies blast the ruling' }]).evidence, 'Allies blast the ruling');
});

test('contrastRows: one row per lean present, left → center → right, two outlets each', () => {
  const rows = contrastRows({
    topic: ['Tariffs'],
    articles: [
      art('right', 'Fox News', 'Tariffs win in court'),
      art('left', 'The Guardian', 'Tariffs slammed as a disaster'),
      art('right', 'New York Post', 'Tariffs boost factories'),
      art('right', 'Daily Wire', 'Tariffs rally markets'),
      art('left', 'The Guardian', 'Court hears the tariffs case'),
    ],
  });
  assert.deepEqual(rows, [
    { lean: 'left', source: 'The Guardian', stance: 'critical', evidence: 'Tariffs slammed as a disaster' },
    { lean: 'right', source: 'Fox News, New York Post', stance: 'supportive', evidence: 'Tariffs rally markets' },
  ]);
});
