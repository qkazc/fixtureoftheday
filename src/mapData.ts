// Hand-drawn geography for the desk map.
//
// PLACEHOLDER: everything here is approximate and drawn by hand: low-poly
// continent outlines (a few dozen points each) and rough port positions.
// Good enough to see where things are; not for navigation.

import type { PortId } from '../engine';

/** [longitude, latitude] in degrees, east and north positive. */
export type LonLat = readonly [number, number];

/** Approximate port positions. */
export const PORT_POSITIONS: Readonly<Record<PortId, LonLat>> = {
  portHedland: [118.6, -20.3],
  newcastle: [151.8, -32.9],
  tubarao: [-40.2, -20.3],
  santos: [-46.3, -24.0],
  richardsBay: [32.1, -28.8],
  kamsar: [-14.6, 10.6],
  usGulf: [-89.4, 29.0],
  qingdao: [120.3, 36.1],
  mundra: [69.7, 22.7],
  rotterdam: [4.1, 51.9],
};

/** Low-poly land outlines, each a closed ring of [lon, lat] points. */
export const LAND: readonly (readonly LonLat[])[] = [
  // North and Central America
  [
    [-168, 66], [-162, 70], [-140, 70], [-125, 70], [-95, 72], [-80, 73], [-65, 62], [-60, 55], [-56, 52],
    [-66, 45], [-70, 42], [-75, 38], [-76, 35], [-81, 31], [-80, 25], [-82, 27], [-84, 30], [-89, 30],
    [-94, 29.5], [-97, 26], [-97, 22], [-94, 18.5], [-91, 19], [-87, 21.5], [-88, 16], [-84, 15], [-83, 11],
    [-79.5, 9], [-77, 8], [-80, 7.5], [-84, 9.5], [-86, 12], [-92, 14.5], [-96, 16], [-105, 20], [-109, 23],
    [-113, 29], [-117, 32.5], [-121, 35], [-124, 40], [-124, 48], [-128, 51], [-135, 57], [-140, 60],
    [-150, 61], [-158, 57], [-165, 55], [-162, 60], [-166, 62],
  ],
  // South America
  [
    [-77, 8], [-72, 12], [-64, 10.5], [-60, 8], [-52, 5], [-50, 0], [-44, -2.5], [-35, -5], [-35, -9],
    [-39, -15], [-40, -20], [-42, -23], [-48, -26], [-53, -34], [-57, -36], [-58, -39], [-65, -41],
    [-65, -45], [-68, -50], [-69, -53], [-74, -52], [-75, -47], [-74, -40], [-72, -30], [-71, -18],
    [-76, -14], [-81, -6], [-80, -2], [-78, 1], [-77.5, 4],
  ],
  // Africa
  [
    [-17, 15], [-17, 21], [-13, 27.5], [-9.5, 31], [-6, 35.8], [0, 35.5], [10, 37], [11, 33], [20, 31],
    [25, 31.5], [32, 31.3], [34, 28], [37, 22], [39, 16], [43, 12.5], [51, 12], [51, 10], [48, 5], [42, -1],
    [40, -5], [39.5, -10], [40.5, -15], [35, -22], [33, -26], [32.5, -28.8], [30, -31.5], [27, -33.7],
    [20, -34.8], [18.4, -34], [17.5, -30], [15, -26], [12, -18], [13.5, -11], [12, -5], [9, 0], [9.5, 4],
    [4, 6.3], [-2, 4.8], [-7.5, 4.4], [-12.5, 7.5], [-15, 10.5],
  ],
  // Europe and Asia
  [
    [-9.5, 37], [-9, 43], [-1.5, 43.5], [-4.5, 48.5], [-1, 49.5], [2, 51], [4, 52], [8, 54], [8.5, 57],
    [10.5, 57.7], [12, 55.5], [10, 59], [5, 59.5], [5, 62], [14, 68], [20, 70], [28, 71], [40, 67],
    [44, 68.5], [60, 69], [70, 73], [80, 73], [100, 77], [115, 73], [130, 71], [150, 71], [170, 70],
    [180, 68], [180, 65], [178, 62], [165, 60], [162, 57], [156, 51], [156, 57], [143, 59], [137, 54],
    [141, 49], [140, 42.5], [135, 43], [130, 42.5], [129, 35.5], [126.5, 34.5], [126, 37.5], [125, 40],
    [121.5, 40.8], [118, 39], [122, 37], [120, 36], [121, 32], [122, 30], [120, 25], [117, 23],
    [113.5, 22], [110, 21], [108, 21.5], [106.5, 18], [109, 12], [105, 9], [103.5, 10.5], [100, 13.5],
    [99, 10], [101, 6.5], [103.5, 1.3], [101, 2.5], [98.5, 8], [98.5, 13], [97.5, 17], [94.5, 16], [94, 19],
    [91.8, 22.5], [88, 22], [86.5, 20], [80.3, 15.5], [80, 10], [77.5, 8], [76, 10], [73, 17], [72.8, 21],
    [70, 22.5], [68.5, 23.5], [66.5, 25.5], [61.5, 25.2], [57, 23.5], [59.8, 22.5], [55, 17], [52, 15.6],
    [45, 12.8], [43.5, 12.75], [42.8, 14.8], [39, 21.5], [35, 28], [34.5, 29.5], [34.2, 31.3], [35, 33],
    [36, 35.5], [33, 36.2], [27, 37], [26.5, 40], [23, 40.5], [21, 38.5], [22, 36.5], [19.5, 40],
    [18.5, 42], [13.5, 45.5], [12.3, 44.5], [16, 41.5], [18.5, 40], [16, 38], [15.6, 38], [12, 41],
    [10, 44], [7, 43.5], [3, 43.2], [3.2, 41.8], [0, 39], [-0.5, 37.6], [-2, 36.7], [-5.6, 36], [-6.5, 36.9],
  ],
  // Australia
  [
    [114, -22], [113.5, -26], [115, -34], [118, -35], [123, -34], [129, -31.5], [135, -34.5], [138, -35],
    [140, -38], [146, -39], [150, -37.5], [153, -31], [153.5, -25], [150.5, -22], [146, -19], [145.5, -15],
    [142.5, -10.7], [141.5, -13], [141.5, -17], [139, -17.5], [136, -15], [137, -12], [132, -11.3],
    [130, -13], [127, -14], [123, -17], [121, -19.5], [118.6, -20.3],
  ],
  // Greenland
  [[-45, 60], [-52, 64], [-55, 70], [-60, 76], [-70, 78], [-30, 80], [-20, 78], [-18, 75], [-22, 70], [-32, 68], [-40, 65]],
  // Great Britain and Ireland
  [[-5.7, 50], [1.3, 51.2], [1.7, 52.7], [0, 53.5], [-1.5, 55], [-2, 57.7], [-3, 58.6], [-5, 58.6], [-6, 56.5], [-5, 55], [-3, 54.5], [-3.3, 53.3], [-4.5, 52.8], [-5.2, 51.7]],
  [[-6, 52], [-6, 54], [-8, 55.2], [-10, 54], [-10, 52], [-8, 51.5]],
  // Iceland
  [[-24, 65.5], [-22, 66.4], [-16, 66.5], [-13.5, 65], [-15, 64.3], [-18, 63.4], [-22, 63.8]],
  // Japan
  [[130, 31], [131.5, 33.8], [135, 33.5], [140, 35], [141, 38], [141.5, 41.3], [140, 40], [139.5, 38], [136.5, 37], [133, 35.5], [130.5, 33.5]],
  // Madagascar
  [[49.3, -12], [50.5, -15.5], [47.5, -25], [45, -25.5], [43.5, -22], [44, -17], [46.5, -15.5]],
  // Borneo, Sumatra, Java, New Guinea
  [[109, 1.5], [111, 2], [114, 4.5], [117, 7], [119, 5], [118, 1], [117.5, -1], [116, -4], [110.5, -3], [109, -1]],
  [[95.3, 5.6], [97.5, 5.2], [100.5, 2], [104, -1], [106, -3], [106, -5.9], [104.5, -5.9], [102, -4], [99, 0]],
  [[105.5, -6.8], [106, -6], [111, -6.5], [114.5, -7.7], [114.5, -8.5], [106.5, -7.4]],
  [[131, -1], [138, -1.5], [145, -4], [147, -6], [150.5, -10.5], [147, -10], [143, -9], [141, -9], [138, -8], [135, -4.5], [132, -4]],
  // Sri Lanka, the Philippines, Cuba, New Zealand
  [[79.8, 9.8], [81.8, 7.5], [81, 6], [80, 6.2], [79.8, 8]],
  [[120, 18.5], [122, 18.5], [122.5, 14], [124, 12.5], [126, 9], [126, 6.5], [125, 6], [122, 7], [123.5, 10.5], [121, 13], [120, 15]],
  [[-85, 22], [-82, 23.1], [-77, 22], [-74.2, 20.2], [-77.7, 19.9], [-80, 21.8]],
  [[172.7, -34.5], [174.5, -36.5], [178, -37.7], [176.8, -40], [174.8, -41.4], [173, -41], [172, -43.5], [170.5, -46], [168, -46.5], [166.5, -45.5], [168.5, -43.5], [172, -41]],
];

/**
 * Sea waypoints for drawing voyages round the land instead of across it.
 * PLACEHOLDER: hand-placed in open water between the outlines above.
 */
export const SEA_POINTS = {
  gulfOfMexico: [-88, 25],
  yucatan: [-86, 21],
  floridaStrait: [-81, 23.8],
  bahamas: [-78, 26],
  atlanticWest: [-65, 32],
  caribbeanEast: [-65, 14],
  panamaCaribbean: [-79.5, 10.5],
  panamaPacific: [-79.5, 7],
  pacificEast: [-120, 12],
  pacificWest: [155, 20],
  philippineSea: [131, 15],
  eastChinaSea: [124, 29],
  taiwanStrait: [119, 22],
  southChinaSea: [110, 8],
  singaporeStrait: [104.3, 0.9],
  malaccaSouth: [101, 2],
  malaccaStrait: [99.5, 4.5],
  sumatraNorth: [95, 7.5],
  sriLankaSouth: [81, 4.5],
  arabianSea: [64, 16],
  gulfOfAden: [50, 13.2],
  babElMandeb: [43.8, 12.6],
  redSeaSouth: [40.8, 16],
  redSeaMouth: [42.85, 13],
  redSeaNorth: [34.8, 27.5],
  portSaid: [32.3, 31.7],
  crete: [25, 34.2],
  sicilyChannel: [12, 37.6],
  algeria: [3, 37.5],
  gibraltar: [-5.7, 35.9],
  stVincent: [-10, 36.5],
  finisterre: [-11, 43],
  channelApproach: [-6, 48.5],
  englishChannel: [-1, 50.1],
  doverStrait: [1.7, 50.95],
  northSea: [2.6, 51.5],
  canaries: [-15.5, 28.5],
  capeVerde: [-20, 14],
  offKamsar: [-17, 10],
  gulfOfGuinea: [-5, 0],
  southAtlantic: [8, -20],
  brazilNorth: [-45, 3],
  brazilEast: [-32, -6],
  offTubarao: [-38, -21],
  offSantos: [-45, -26],
  capeOfGoodHope: [19, -36.5],
  agulhas: [27, -36.5],
  offRichardsBay: [35, -29.5],
  mozambiqueChannel: [40, -20],
  comoros: [42, -11],
  indianSouth: [60, -30],
  capeLeeuwin: [113, -37],
  sharkBay: [109, -25],
  offPortHedland: [117, -18.5],
  lombokSouth: [115.8, -11],
  lombok: [115.8, -8.6],
  makassar: [118.5, -3],
  celebesSea: [121, 3],
  mindanaoSouth: [126.5, 4.5],
  newGuineaNorth: [142, 2],
  solomonSea: [153, -6],
  coralSea: [156, -15],
  offNewcastle: [154, -33],
  bassStrait: [146, -41],
  capeHowe: [151.5, -38.5],
  greatBight: [130, -36],
} as const satisfies Record<string, LonLat>;

export type SeaPointId = keyof typeof SEA_POINTS;
export type MapNode = PortId | SeaPointId;

/** Two-way sea lanes. Canals cross land on purpose. */
export const SEA_LANES: readonly (readonly [MapNode, MapNode, 'canal'?])[] = [
  // Americas
  ['usGulf', 'gulfOfMexico'], ['gulfOfMexico', 'yucatan'], ['gulfOfMexico', 'floridaStrait'],
  ['floridaStrait', 'bahamas'], ['bahamas', 'atlanticWest'], ['yucatan', 'panamaCaribbean'],
  ['yucatan', 'caribbeanEast'], ['caribbeanEast', 'brazilNorth'], ['brazilNorth', 'brazilEast'],
  ['panamaCaribbean', 'panamaPacific', 'canal'], ['panamaPacific', 'pacificEast'],
  // North Atlantic and Europe
  ['atlanticWest', 'channelApproach'], ['channelApproach', 'englishChannel'], ['englishChannel', 'doverStrait'], ['doverStrait', 'northSea'],
  ['northSea', 'rotterdam'], ['channelApproach', 'finisterre'], ['finisterre', 'stVincent'],
  ['finisterre', 'canaries'], ['stVincent', 'gibraltar'], ['canaries', 'capeVerde'],
  // Mediterranean, Suez, Red Sea
  ['gibraltar', 'algeria'], ['algeria', 'sicilyChannel'], ['sicilyChannel', 'crete'], ['crete', 'portSaid'],
  ['portSaid', 'redSeaNorth', 'canal'], ['redSeaNorth', 'redSeaSouth'], ['redSeaSouth', 'redSeaMouth'], ['redSeaMouth', 'babElMandeb'],
  ['babElMandeb', 'gulfOfAden'], ['gulfOfAden', 'arabianSea'],
  // West Africa and South Atlantic
  ['kamsar', 'offKamsar'], ['offKamsar', 'capeVerde'], ['offKamsar', 'gulfOfGuinea'],
  ['capeVerde', 'brazilEast'], ['gulfOfGuinea', 'southAtlantic'], ['southAtlantic', 'capeOfGoodHope'],
  ['tubarao', 'offTubarao'], ['santos', 'offSantos'], ['offSantos', 'offTubarao'], ['offTubarao', 'brazilEast'],
  ['offTubarao', 'capeOfGoodHope'], ['offSantos', 'capeOfGoodHope'],
  // Southern Africa and the Indian Ocean
  ['capeOfGoodHope', 'agulhas'], ['agulhas', 'offRichardsBay'], ['offRichardsBay', 'richardsBay'],
  ['offRichardsBay', 'mozambiqueChannel'], ['mozambiqueChannel', 'comoros'], ['comoros', 'arabianSea'],
  ['agulhas', 'indianSouth'], ['indianSouth', 'sriLankaSouth'], ['indianSouth', 'capeLeeuwin'],
  ['indianSouth', 'lombokSouth'], ['arabianSea', 'mundra'], ['arabianSea', 'sriLankaSouth'],
  // South-east Asia and China
  ['sriLankaSouth', 'sumatraNorth'], ['sumatraNorth', 'malaccaStrait'], ['malaccaStrait', 'malaccaSouth'],
  ['malaccaSouth', 'singaporeStrait'], ['singaporeStrait', 'southChinaSea'], ['southChinaSea', 'taiwanStrait'],
  ['taiwanStrait', 'eastChinaSea'], ['eastChinaSea', 'qingdao'], ['philippineSea', 'eastChinaSea'],
  ['lombokSouth', 'lombok'], ['lombok', 'makassar'], ['makassar', 'celebesSea'], ['celebesSea', 'mindanaoSouth'],
  ['mindanaoSouth', 'philippineSea'], ['pacificWest', 'philippineSea'], ['pacificEast', 'pacificWest'],
  // Australia
  ['portHedland', 'offPortHedland'], ['offPortHedland', 'lombokSouth'], ['offPortHedland', 'sriLankaSouth'],
  ['offPortHedland', 'indianSouth'], ['offPortHedland', 'sharkBay'], ['sharkBay', 'capeLeeuwin'],
  ['capeLeeuwin', 'greatBight'], ['greatBight', 'bassStrait'], ['bassStrait', 'capeHowe'], ['capeHowe', 'offNewcastle'],
  ['newcastle', 'offNewcastle'], ['offNewcastle', 'coralSea'], ['coralSea', 'solomonSea'],
  ['solomonSea', 'newGuineaNorth'], ['newGuineaNorth', 'philippineSea'], ['offNewcastle', 'pacificEast'],
];
