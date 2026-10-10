// Port catalogue and sea distances.
//
// PLACEHOLDER: distances are game estimates, approximate, rounded to the
// nearest 50 nm. Plausible for the usual routes (e.g. Brazil to China via
// the Cape of Good Hope, Australia to Europe via Suez), not taken from
// official distance tables.
// SIMPLIFICATION: one fixed distance per port pair; no canal choices, size
// limits or weather routing. US Gulf and Kamsar stand for wider areas.

export type Commodity = 'ironOre' | 'coal' | 'grain' | 'bauxite';

export type PortId =
  | 'portHedland' | 'newcastle' | 'tubarao' | 'santos' | 'richardsBay'
  | 'kamsar' | 'usGulf' | 'qingdao' | 'mundra' | 'rotterdam';

export interface Port {
  id: PortId;
  name: string;
  country: string;
  exports: readonly Commodity[];
  imports: readonly Commodity[];
}

const port = (id: PortId, name: string, country: string, exports: Commodity[], imports: Commodity[]): Port =>
  ({ id, name, country, exports, imports });

export const PORTS: Readonly<Record<PortId, Port>> = {
  portHedland: port('portHedland', 'Port Hedland', 'Australia', ['ironOre'], []),
  newcastle: port('newcastle', 'Newcastle', 'Australia', ['coal'], []),
  tubarao: port('tubarao', 'Tubarão', 'Brazil', ['ironOre'], []),
  santos: port('santos', 'Santos', 'Brazil', ['grain'], []),
  richardsBay: port('richardsBay', 'Richards Bay', 'South Africa', ['coal'], []),
  kamsar: port('kamsar', 'Kamsar', 'Guinea', ['bauxite'], []),
  usGulf: port('usGulf', 'US Gulf (New Orleans)', 'United States', ['grain'], []),
  qingdao: port('qingdao', 'Qingdao', 'China', [], ['ironOre', 'coal', 'bauxite', 'grain']),
  mundra: port('mundra', 'Mundra', 'India', [], ['coal']),
  rotterdam: port('rotterdam', 'Rotterdam', 'Netherlands', [], ['ironOre', 'coal', 'grain']),
};

export const PORT_IDS = Object.keys(PORTS) as PortId[];

// Game estimates, approximate (nautical miles). Each pair is listed once.
const DISTANCES: readonly [PortId, PortId, number][] = [
  ['portHedland', 'newcastle', 3300], ['portHedland', 'tubarao', 8750],
  ['portHedland', 'santos', 8950], ['portHedland', 'richardsBay', 4950],
  ['portHedland', 'kamsar', 8850], ['portHedland', 'usGulf', 11900],
  ['portHedland', 'qingdao', 3800], ['portHedland', 'mundra', 4050],
  ['portHedland', 'rotterdam', 9600],
  ['newcastle', 'tubarao', 9800], ['newcastle', 'santos', 9950],
  ['newcastle', 'richardsBay', 6300], ['newcastle', 'kamsar', 9900],
  ['newcastle', 'usGulf', 9100], ['newcastle', 'qingdao', 4950],
  ['newcastle', 'mundra', 6550], ['newcastle', 'rotterdam', 12050],
  ['tubarao', 'santos', 450], ['tubarao', 'richardsBay', 4050],
  ['tubarao', 'kamsar', 2650], ['tubarao', 'usGulf', 5000],
  ['tubarao', 'qingdao', 11150], ['tubarao', 'mundra', 7900],
  ['tubarao', 'rotterdam', 5000],
  ['santos', 'richardsBay', 4250], ['santos', 'kamsar', 3100],
  ['santos', 'usGulf', 5450], ['santos', 'qingdao', 11300],
  ['santos', 'mundra', 8100], ['santos', 'rotterdam', 5450],
  ['richardsBay', 'kamsar', 4200], ['richardsBay', 'usGulf', 9050],
  ['richardsBay', 'qingdao', 7250], ['richardsBay', 'mundra', 3850],
  ['richardsBay', 'rotterdam', 7050],
  ['kamsar', 'usGulf', 5550], ['kamsar', 'qingdao', 11250],
  ['kamsar', 'mundra', 7600], ['kamsar', 'rotterdam', 2950],
  ['usGulf', 'qingdao', 10100], ['usGulf', 'mundra', 10200], ['usGulf', 'rotterdam', 4750],
  ['qingdao', 'mundra', 5350], ['qingdao', 'rotterdam', 10900],
  ['mundra', 'rotterdam', 6300],
];

const pairKey = (a: PortId, b: PortId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
const DISTANCE_BY_PAIR = new Map(DISTANCES.map(([a, b, nm]) => [pairKey(a, b), nm]));

/** Sea distance between two ports in nautical miles (0 for the same port). */
export function distanceNm(from: PortId, to: PortId): number {
  if (!(from in PORTS)) throw new RangeError(`unknown port id: ${String(from)}`);
  if (!(to in PORTS)) throw new RangeError(`unknown port id: ${String(to)}`);
  if (from === to) return 0;
  const nm = DISTANCE_BY_PAIR.get(pairKey(from, to));
  if (nm === undefined) throw new Error(`no distance for ${from} to ${to}`);
  return nm;
}
