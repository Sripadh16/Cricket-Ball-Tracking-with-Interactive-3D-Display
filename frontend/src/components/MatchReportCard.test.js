import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MatchReportCard from './MatchReportCard';

jest.mock('@mui/icons-material', () => new Proxy({ __esModule: true }, {
  get: (_, key) => key === '__esModule' ? true : () => null
}));

test('incomplete analysis produces an educational report with unknown values, never certification or a default OUT', () => {
  render(<MatchReportCard open onClose={() => {}} trajectoryData={{ points: [], drs_evaluation: {} }} />);
  expect(screen.getByText('Delivery analysis report')).toBeInTheDocument();
  expect(screen.getByText('VERDICT: Unavailable')).toBeInTheDocument();
  expect(screen.queryByText(/OFFICIAL VERIFIED|ICC CERTIFIED|12.4°|3.2°/)).not.toBeInTheDocument();
});
