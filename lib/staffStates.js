const RED = '#BA0C2F';

// One look per payment state, shared by the grid, legend and detail drawer.
export const STATES = {
  paid:     { bg: RED, fg: '#fff', label: 'Paid' },
  member:   { bg: RED, fg: '#fff', label: 'Membership hours' },
  balance:  { bg: '#000', fg: '#fff', label: 'Balance due' },
  unpaid:   { bg: '#000', fg: '#fff', label: 'Unpaid' },
  clinic:   { bg: '#7A0A20', fg: '#fff', label: 'Clinic' },
  donated:  { bg: '#1E6B34', fg: '#fff', label: 'Donated' },
  hold:     { bg: '#8A8A8A', fg: '#fff', label: 'Staff hold' },
  holding:  { bg: '#fff', fg: '#000', border: '1.5px dashed rgba(0,0,0,.45)', label: 'Checking out' },
  canceled: { bg: '#F2F0ED', fg: 'rgba(0,0,0,.5)', border: '1px solid rgba(0,0,0,.12)', label: 'Canceled' },
};

export const LEGEND = ['paid', 'unpaid', 'balance', 'clinic', 'donated', 'hold', 'holding'];
