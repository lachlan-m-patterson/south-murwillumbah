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

export const TOURS = {
  residential: {
    title: 'Residential flyover', subtitle: 'River Street, south from the bridge',
    speed: 17, altitude: 95, back: 150, lead: 110, side: -45,
    path: [[539330, 6866345], [539268, 6866272], [539208, 6866198], [539194, 6866172], [539150, 6866040], [539108, 6865907],
      [539091, 6865806], [539130, 6865680], [539152, 6865560], [539171, 6865460], [539174, 6865300], [539176, 6865127]],
    chapters: [
      { at: 0.0, title: 'Off the bridge', text: 'River Street starts at the foot of the Alma Street bridge and runs south along the river.' },
      { at: 0.16, title: 'Hartman Park', text: 'Parkland sits between the street and the levee. The houses face the river across this open strip.' },
      { at: 0.3, title: 'Greville Street', text: 'Greville Street cuts east to Tweed Valley Way, past St Joseph’s Primary School and the playground reserve.', feature: 'school' },
      { at: 0.5, title: 'Levee and riverbank', text: 'On the right, the levee follows the bank. Low-density housing (R2) fills the land between River Street and the highway.', feature: 'levee' },
      { at: 0.78, title: 'South end', text: 'River Street narrows as the town gives way to cane fields and rural land at the southern edge.' }
    ]
  },
  commercial: {
    title: 'Commercial flyover', subtitle: 'Town centre → bridge → Prospero St → station',
    speed: 15, altitude: 80, back: 130, lead: 90, side: -40,
    path: [[538985, 6866470], [539050, 6866425], [539113, 6866394], [539187, 6866360], [539261, 6866326], [539268, 6866272],
      [539330, 6866231], [539392, 6866189], [539427, 6866166], [539465, 6866238], [539518, 6866288], [539600, 6866292], [539660, 6866280]],
    chapters: [
      { at: 0.0, title: 'Murwillumbah town centre', text: 'The flight starts in the E2 Commercial Centre on the north bank.' },
      { at: 0.16, title: 'Alma Street Bridge', text: 'The bridge carries traffic over the Tweed into South Murwillumbah.', feature: 'bridge' },
      { at: 0.42, title: 'Prospero Street', text: 'South Murwillumbah’s shopping strip: shops, offices and showrooms in E3 Productivity Support zoning.', feature: 'prospero' },
      { at: 0.66, title: 'Tweed Valley Way', text: 'At the junction the highway heads north-east towards the old railway yard.' },
      { at: 0.82, title: 'Railway station', text: 'The former terminus of the Murwillumbah line, now the start of the rail trail.', feature: 'station' }
    ]
  }
};

export const GUIDED = ['zoning', 'bridge', 'prospero', 'station', 'river', 'school', 'levee'];
