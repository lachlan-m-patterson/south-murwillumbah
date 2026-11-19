// Feature cards, camera views and flyover paths. Views: target [E, N],
// distance (m), azimuth (deg clockwise from north, camera side), tilt
// (deg from straight down).

export const OVERVIEW = { target: [539330, 6865800], dist: 1850, az: 188, tilt: 46 };

export const FEATURES = [
  {
    id: 'zoning', kicker: 'Planning', title: 'Zoning of South Murwillumbah', color: '#e8a0a0',
    view: { target: [539330, 6865840], dist: 1500, az: 180, tilt: 12 },
    text: 'Land zoning from the Tweed Local Environmental Plan 2014. South Murwillumbah is mostly R2 Low Density Residential. A band of E3 Productivity Support follows Prospero Street, the rail corridor and Tweed Valley Way. RE1 public parkland lines the riverbank, and RU1 cane land lies to the east. Across the bridge is the E2 Commercial Centre of Murwillumbah.',
    zoning: true
  },
  {
    id: 'bridge', kicker: 'Transport', title: 'Alma Street Bridge', color: '#f3c969',
    view: { target: [539187, 6866360], dist: 300, az: 208, tilt: 62 },
    text: 'The Alma Street bridge crosses the Tweed River between the Murwillumbah town centre and South Murwillumbah. It is the main road link into this part of town. Traffic comes off the bridge straight into Prospero Street and River Street.'
  },
  {
    id: 'prospero', kicker: 'Commercial', title: 'Prospero Street', color: '#4f86d6',
    view: { target: [539345, 6866225], dist: 280, az: 165, tilt: 58 },
    text: 'South Murwillumbah’s main commercial street runs south-east from the foot of the bridge to the Tweed Valley Way junction. It is lined with shops, offices and showrooms, all zoned E3 Productivity Support.'
  },
  {
    id: 'station', kicker: 'Transport', title: 'Railway station and tracks', color: '#c98a4b',
    view: { target: [539540, 6866215], dist: 380, az: 205, tilt: 60 },
    text: 'Murwillumbah station was the northern end of the Casino–Murwillumbah railway, which closed in 2004. The platform, turntable and sidings are still mapped. The line now carries the Northern Rivers Rail Trail, which runs south past the town.'
  },
  {
    id: 'river', kicker: 'Residential', title: 'River Street', color: '#ef8c7f',
    view: { target: [539150, 6865700], dist: 760, az: 160, tilt: 55 },
    text: 'River Street is the main residential street. It runs south from the bridge and follows the riverbank just inside the levee. Most of its lots are R2 Low Density Residential, typically raised timber houses on long, narrow blocks.'
  },
  {
    id: 'school', kicker: 'Community', title: 'St Joseph’s School and playground', color: '#f2e15b',
    view: { target: [539228, 6865980], dist: 230, az: 140, tilt: 55 },
    text: 'St Joseph’s Primary School is at 3 Greville Street, between River Street and Tweed Valley Way. Across the lane is an RE1 public reserve with open grass and play equipment.'
  },
  {
    id: 'levee', kicker: 'Infrastructure', title: 'The levee wall', color: '#b98cf0',
    view: { target: [539075, 6865830], dist: 520, az: 245, tilt: 60 },
    text: 'An earth levee runs along the riverbank from the bridge to the south end of River Street. It separates the riverside parkland from the houses. Its crest was traced from the 1 m terrain model.'
  }
];

export const GUIDED = ['bridge', 'prospero', 'station', 'river', 'school', 'levee', 'zoning'];
