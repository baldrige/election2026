// Time when the LAST polls close in each state, Eastern time (hour, minute, 24h; 24 = midnight).
// Based on usual statutory hours; verify for 2026 with each state's election office.
window.POLL_CLOSINGS = [
  { t: [19, 0],  states: ['GA', 'IN', 'KY', 'SC', 'VA', 'VT'] },
  { t: [19, 30], states: ['NC', 'OH', 'WV'] },
  { t: [20, 0],  states: ['AL', 'CT', 'DC', 'DE', 'FL', 'IL', 'MA', 'MD', 'ME', 'MO', 'MS', 'NH', 'NJ', 'OK', 'PA', 'RI', 'TN'] },
  { t: [20, 30], states: ['AR'] },
  { t: [21, 0],  states: ['AZ', 'CO', 'IA', 'KS', 'LA', 'MI', 'MN', 'NE', 'NM', 'NY', 'SD', 'TX', 'WI', 'WY'] },
  { t: [22, 0],  states: ['MT', 'ND', 'NV', 'UT'] },
  { t: [23, 0],  states: ['CA', 'ID', 'OR', 'WA'] },
  { t: [24, 0],  states: ['HI'] },
  { t: [25, 0],  states: ['AK'] },
];
